import { randomBytes } from "node:crypto";
import { FIXTURES, InspectInputError, JobQueue, inspect, type LoadedConfig } from "@opscope/engine";
import { redactText, short, type InspectRequest } from "@opscope/core";
import type { Session } from "@opscope/diagnosis";
import { openStore, type Store } from "@opscope/store";

export const newSessionId = () => `ops_${randomBytes(4).toString("hex")}`;

export interface StartMeta {
  label?: string;
  source?: Session["source"];
  replayOf?: string;
}

/** Creates sessions, runs them through the bounded job queue and persists every step. */
export class SessionService {
  readonly store: Store;
  readonly queue: JobQueue;

  constructor(readonly cfg: LoadedConfig) {
    this.store = openStore(cfg.config.dataDir);
    this.queue = new JobQueue(cfg.config.replay.maxConcurrent, cfg.config.replay.timeoutMs);
  }

  /** Inserts a queued session and starts it in the background. */
  start(req: InspectRequest, meta: StartMeta = {}): Session {
    const s = this.create(req, meta);
    void this.execute(s);
    return s;
  }

  /** Runs to completion (CLI). */
  async run(req: InspectRequest, meta: StartMeta = {}, onStep?: (step: string) => void): Promise<Session> {
    const s = this.create(req, meta);
    await this.execute(s, onStep);
    return this.store.get(s.id)!;
  }

  private create(req: InspectRequest, meta: StartMeta): Session {
    const fixture = req.connection.kind === "fixture" ? FIXTURES.find((f) => f.id === (req.connection as { fixtureId: string }).fixtureId) : undefined;
    const sender = typeof req.userOp === "object" && req.userOp && "sender" in req.userOp ? String((req.userOp as { sender: unknown }).sender) : undefined;
    const now = new Date().toISOString();
    const s: Session = {
      id: newSessionId(),
      createdAt: now,
      updatedAt: now,
      label: meta.label ?? req.label ?? fixture?.title ?? `UserOp from ${short(sender)}`,
      source: meta.source ?? (fixture ? "fixture" : "live"),
      demo: !!fixture?.demo,
      status: "queued",
      progress: [],
      chainId: req.chainId,
      request: req,
      replayOf: meta.replayOf,
    };
    this.store.insert(s);
    return s;
  }

  private async execute(s: Session, onStep?: (step: string) => void) {
    const progress: Session["progress"] = [];
    const t0 = Date.now();
    try {
      await this.queue.run(async (signal) => {
        this.store.update(s.id, { status: "running" });
        const out = await inspect(s.request, {
          config: this.cfg,
          signal,
          progress: (step) => {
            progress.push({ step, at: Date.now() - t0 });
            this.store.update(s.id, { progress: [...progress] });
            onStep?.(step);
          },
        });
        this.store.update(s.id, {
          status: "done",
          evidence: out.evidence,
          diagnosis: out.diagnosis,
          code: out.diagnosis.code,
          stage: out.diagnosis.stage,
          verdict: out.diagnosis.verdict,
          demo: out.demo,
          durationMs: Date.now() - t0,
        });
      });
    } catch (e) {
      // viem errors can embed the RPC URL (and its key) in their details: keep the first line, then redact
      const raw = e instanceof InspectInputError ? e.message : String((e as Error).message ?? e).split("\n")[0]!;
      this.store.update(s.id, { status: "error", error: redactText(raw, this.cfg.secrets), durationMs: Date.now() - t0 });
    }
  }
}
