import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { chainName, hostOf, type ConnectionInfo } from "@opscope/core";

const configSchema = z.object({
  server: z.object({ host: z.string().default("127.0.0.1"), port: z.number().int().default(4337) }).default({ host: "127.0.0.1", port: 4337 }),
  connections: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, { error: "connection ids are lowercase-kebab" }),
        chainId: z.number().int().positive(),
        /** literal URL or ${ENV_VAR}; the URL never leaves the server */
        url: z.string(),
        label: z.string().optional(),
      }),
    )
    .default([]),
  replay: z
    .object({
      timeoutMs: z.number().int().min(5_000).default(90_000),
      maxConcurrent: z.number().int().min(1).max(8).default(2),
      anvilPath: z.string().default("anvil"),
    })
    .default({ timeoutMs: 90_000, maxConcurrent: 2, anvilPath: "anvil" }),
  dataDir: z.string().default(".opscope"),
});

export type OpscopeConfig = z.infer<typeof configSchema>;

export interface ResolvedConnection {
  info: ConnectionInfo;
  url?: string;
  /** why the connection can't be used (e.g. its env var is unset) */
  problem?: string;
}

export interface LoadedConfig {
  config: OpscopeConfig;
  path?: string;
  connections: ResolvedConnection[];
  /** every resolved RPC URL; redaction replaces these verbatim before anything is written or sent */
  secrets: string[];
}

const ENV_REF = /\$\{([A-Z0-9_]+)\}/g;

export function loadConfig(path?: string, env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const file = path ? resolve(path) : (env.OPSCOPE_CONFIG ? resolve(env.OPSCOPE_CONFIG) : findUp("opscope.config.json"));
  let raw: unknown = {};
  if (file) {
    if (!existsSync(file)) throw new Error(`Config not found: ${file}`);
    raw = JSON.parse(readFileSync(file, "utf8"));
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid config${file ? ` (${file})` : ""}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const config = parsed.data;
  if (file) config.dataDir = resolve(dirname(file), config.dataDir);
  else config.dataDir = resolve(config.dataDir);

  const secrets: string[] = [];
  const connections = config.connections.map((c): ResolvedConnection => {
    const missing: string[] = [];
    const url = c.url.replace(ENV_REF, (_m, name: string) => {
      const v = env[name];
      if (!v) missing.push(name);
      return v ?? "";
    });
    const info: ConnectionInfo = { id: c.id, chainId: c.chainId, label: c.label ?? chainName(c.chainId), host: "—" };
    if (missing.length) return { info, problem: `Set ${missing.join(", ")} in the server environment.` };
    if (!/^https?:\/\//.test(url) && !/^wss?:\/\//.test(url)) return { info, problem: "url must be http(s)://" };
    secrets.push(url);
    info.host = hostOf(url);
    return { info, url };
  });
  return { config, path: file, connections, secrets };
}

function findUp(name: string, from = process.cwd()): string | undefined {
  let dir = resolve(from);
  for (;;) {
    const p = resolve(dir, name);
    if (existsSync(p)) return p;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

export function findConnection(cfg: LoadedConfig, id: string): ResolvedConnection | undefined {
  return cfg.connections.find((c) => c.info.id === id);
}
