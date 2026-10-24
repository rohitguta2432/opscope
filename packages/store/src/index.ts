import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Evidence, InspectRequest } from "@opscope/core";
import type { Diagnosis, Session, SessionSummary } from "@opscope/diagnosis";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  label: text("label").notNull(),
  source: text("source").$type<Session["source"]>().notNull(),
  demo: integer("demo", { mode: "boolean" }).notNull(),
  status: text("status").$type<Session["status"]>().notNull(),
  progress: text("progress", { mode: "json" }).$type<Session["progress"]>().notNull(),
  chainId: integer("chain_id").notNull(),
  code: text("code"),
  stage: text("stage"),
  verdict: text("verdict").$type<Diagnosis["verdict"]>(),
  userOpHash: text("user_op_hash"),
  request: text("request", { mode: "json" }).$type<InspectRequest>().notNull(),
  evidence: text("evidence", { mode: "json" }).$type<Evidence>(),
  diagnosis: text("diagnosis", { mode: "json" }).$type<Diagnosis>(),
  error: text("error"),
  durationMs: integer("duration_ms"),
  replayOf: text("replay_of"),
});

const DDL = `CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, label TEXT NOT NULL,
  source TEXT NOT NULL, demo INTEGER NOT NULL, status TEXT NOT NULL, progress TEXT NOT NULL,
  chain_id INTEGER NOT NULL, code TEXT, stage TEXT, verdict TEXT, user_op_hash TEXT,
  request TEXT NOT NULL, evidence TEXT, diagnosis TEXT, error TEXT, duration_ms INTEGER, replay_of TEXT
);
CREATE INDEX IF NOT EXISTS sessions_created ON sessions(created_at DESC);`;

type Row = typeof sessions.$inferSelect;

const toSession = (r: Row): Session => ({
  id: r.id,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  label: r.label,
  source: r.source,
  demo: r.demo,
  status: r.status,
  progress: r.progress,
  chainId: r.chainId,
  code: r.code ?? undefined,
  stage: r.stage ?? undefined,
  verdict: r.verdict ?? undefined,
  request: r.request,
  evidence: r.evidence ?? undefined,
  diagnosis: r.diagnosis ?? undefined,
  error: r.error ?? undefined,
  durationMs: r.durationMs ?? undefined,
  replayOf: r.replayOf ?? undefined,
});

export type Store = ReturnType<typeof openStore>;

/** SQLite session store at <dataDir>/opscope.db. Sessions hold redacted evidence only. */
export function openStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(join(dataDir, "opscope.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(DDL);
  const db = drizzle(sqlite);

  return {
    path: join(dataDir, "opscope.db"),
    insert(s: Session) {
      db.insert(sessions)
        .values({ ...s, code: s.code ?? null, stage: s.stage ?? null, verdict: s.verdict ?? null, userOpHash: s.evidence?.userOpHash ?? null, evidence: s.evidence ?? null, diagnosis: s.diagnosis ?? null, error: s.error ?? null, durationMs: s.durationMs ?? null, replayOf: s.replayOf ?? null })
        .run();
    },
    update(id: string, patch: Partial<Session>) {
      const set: Partial<Row> = { updatedAt: new Date().toISOString() };
      for (const [k, v] of Object.entries(patch)) (set as Record<string, unknown>)[k] = v ?? null;
      if (patch.evidence) set.userOpHash = patch.evidence.userOpHash;
      db.update(sessions).set(set).where(eq(sessions.id, id)).run();
    },
    get(id: string): Session | undefined {
      const r = db.select().from(sessions).where(eq(sessions.id, id)).get();
      return r ? toSession(r) : undefined;
    },
    list(limit = 50): SessionSummary[] {
      return db
        .select({
          id: sessions.id, createdAt: sessions.createdAt, updatedAt: sessions.updatedAt, label: sessions.label, source: sessions.source,
          demo: sessions.demo, status: sessions.status, progress: sessions.progress, chainId: sessions.chainId, code: sessions.code,
          stage: sessions.stage, verdict: sessions.verdict, userOpHash: sessions.userOpHash, error: sessions.error, durationMs: sessions.durationMs, replayOf: sessions.replayOf,
        })
        .from(sessions)
        .orderBy(desc(sessions.createdAt))
        .limit(limit)
        .all()
        .map((r) => ({ ...r, code: r.code ?? undefined, stage: r.stage ?? undefined, verdict: r.verdict ?? undefined, userOpHash: r.userOpHash ?? undefined, error: r.error ?? undefined, durationMs: r.durationMs ?? undefined, replayOf: r.replayOf ?? undefined }));
    },
    remove(id: string) {
      db.delete(sessions).where(eq(sessions.id, id)).run();
    },
    close() {
      sqlite.close();
    },
  };
}
