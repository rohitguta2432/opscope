import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import {
  CHAINS,
  ENTRYPOINTS,
  OPSCOPE_VERSION,
  addressSchema,
  getUserOpHashV07,
  hexSchema,
  parseUserOpInput,
  requiredPrefund,
  eth,
  type InspectRequest,
} from "@opscope/core";
import { FIXTURES, anvilVersion, bundleFiles, fixtureRequest, zipBundle, type LoadedConfig } from "@opscope/engine";
import { renderDiagnosisMarkdown, reproduceCommand } from "@opscope/diagnosis";
import { SessionService } from "./service";

const inspectBody = z.object({
  userOp: z.unknown(),
  chainId: z.number().int().positive(),
  entryPoint: addressSchema,
  connection: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("rpc"), id: z.string().min(1) }),
    z.object({ kind: z.literal("fixture"), fixtureId: z.string().min(1) }),
  ]),
  block: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("latest") }),
    z.object({ kind: z.literal("number"), number: z.string().regex(/^\d+$/), hash: hexSchema.optional() }),
    z.object({ kind: z.literal("inclusion"), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, { error: "expected a 32-byte transaction hash" }) }),
  ]),
  mode: z.enum(["preflight+replay", "preflight"]),
  label: z.string().max(120).optional(),
});

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function buildServer(cfg: LoadedConfig, opts: { webDist?: string; logger?: boolean } = {}): { app: FastifyInstance; service: SessionService } {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  const service = new SessionService(cfg);
  const allowRemote = process.env.OPSCOPE_ALLOW_REMOTE === "1";

  // Local-first: refuse other Host headers (DNS rebinding) and cross-site browser origins.
  app.addHook("onRequest", async (req, reply) => {
    if (allowRemote) return;
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) return reply.code(403).send({ error: "OpScope only answers on localhost." });
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (!LOCAL_HOSTS.has(new URL(origin).hostname)) return reply.code(403).send({ error: "Cross-origin requests are refused." });
      } catch {
        return reply.code(403).send({ error: "Bad Origin header." });
      }
    }
  });

  app.get("/api/health", async () => {
    const av = await anvilVersion(cfg.config.replay.anvilPath);
    return {
      ok: true,
      version: OPSCOPE_VERSION,
      anvil: { available: !!av, version: av ?? null },
      config: { path: cfg.path ?? null, connections: cfg.connections.length, usable: cfg.connections.filter((c) => c.url).length },
      queue: service.queue.stats,
      localOnly: !allowRemote,
      store: service.store.path.replace(process.env.HOME ?? "~", "~"),
    };
  });

  app.get("/api/config", async () => ({
    chains: CHAINS,
    entryPoints: ENTRYPOINTS,
    connections: cfg.connections.map((c) => ({ ...c.info, available: !!c.url, problem: c.problem ?? null })),
    fixtures: FIXTURES,
  }));

  app.post("/api/validate", async (req) => {
    const body = z.object({ userOp: z.unknown(), chainId: z.number().int().optional(), entryPoint: addressSchema.optional() }).safeParse(req.body);
    if (!body.success) return { ok: false, issues: body.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
    const parsed = parseUserOpInput(body.data.userOp);
    if (!parsed.ok) return parsed;
    const chainId = body.data.chainId ?? parsed.chainId;
    const ep = body.data.entryPoint ?? parsed.entryPoint;
    return {
      ok: true,
      format: parsed.format,
      warnings: parsed.warnings,
      chainId: parsed.chainId ?? null,
      entryPoint: parsed.entryPoint ?? null,
      userOpHash: chainId && ep ? getUserOpHashV07(parsed.op, ep, chainId) : null,
      requiredPrefund: eth(requiredPrefund(parsed.op)),
      paymaster: parsed.op.paymaster ?? null,
      factory: parsed.op.factory ?? null,
    };
  });

  app.post("/api/sessions", async (req, reply) => {
    const body = inspectBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid request", issues: body.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    if (body.data.connection.kind === "rpc") {
      const parsed = parseUserOpInput(body.data.userOp);
      if (!parsed.ok) return reply.code(400).send({ error: "Invalid UserOperation", issues: parsed.issues });
    }
    const s = service.start(body.data as InspectRequest);
    return reply.code(202).send({ id: s.id });
  });

  app.post<{ Params: { id: string } }>("/api/fixtures/:id/run", async (req, reply) => {
    if (!FIXTURES.some((f) => f.id === req.params.id)) return reply.code(404).send({ error: "Unknown fixture" });
    const s = service.start(fixtureRequest(req.params.id));
    return reply.code(202).send({ id: s.id });
  });

  app.get<{ Querystring: { limit?: string } }>("/api/sessions", async (req) => service.store.list(Math.min(Number(req.query.limit ?? 50) || 50, 200)));

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    const s = service.store.get(req.params.id);
    return s ?? reply.code(404).send({ error: "Session not found" });
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    service.store.remove(req.params.id);
    return reply.code(204).send();
  });

  /** Re-runs a session pinned to the exact block (or inclusion tx) it recorded. */
  app.post<{ Params: { id: string } }>("/api/sessions/:id/replay", async (req, reply) => {
    const s = service.store.get(req.params.id);
    if (!s?.evidence) return reply.code(404).send({ error: "Session has no recorded context to replay" });
    const ctx = s.evidence.context;
    const pinned: InspectRequest = {
      ...s.request,
      userOp: s.request.connection.kind === "fixture" && s.request.userOp == null ? null : s.evidence.userOp,
      block: ctx.inclusion ? { kind: "inclusion", txHash: ctx.inclusion.txHash } : ctx.block.hash !== "0x" ? { kind: "number", number: ctx.block.number, hash: ctx.block.hash } : s.request.block,
    };
    const next = service.start(pinned, { label: s.label, replayOf: s.id, source: s.source });
    return reply.code(202).send({ id: next.id });
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/bundle.zip", async (req, reply) => {
    const s = service.store.get(req.params.id);
    if (!s?.evidence) return reply.code(404).send({ error: "Nothing to export yet" });
    const root = `opscope-${s.id}`;
    const zip = zipBundle(bundleFiles(s), root);
    return reply.header("content-type", "application/zip").header("content-disposition", `attachment; filename="${root}.zip"`).send(Buffer.from(zip));
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/diagnosis.md", async (req, reply) => {
    const s = service.store.get(req.params.id);
    if (!s?.evidence || !s.diagnosis) return reply.code(404).send({ error: "Nothing to export yet" });
    return reply.type("text/markdown; charset=utf-8").send(renderDiagnosisMarkdown(s.evidence, s.diagnosis, { sessionId: s.id, reproduceCommand: reproduceCommand(s.id), demo: s.demo }));
  });

  const dist = opts.webDist ?? join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(join(dist, "index.html"))) {
    app.register(fastifyStatic, { root: dist, prefix: "/", index: ["index.html"] });
  }

  return { app, service };
}
