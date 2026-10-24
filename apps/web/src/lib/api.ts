import type { ChainInfo, ConnectionInfo, EntryPointInfo, FixtureInfo, InspectRequest, InputIssue } from "@opscope/core";
import type { Session, SessionSummary } from "@opscope/diagnosis";

export interface Health {
  ok: boolean;
  version: string;
  anvil: { available: boolean; version: string | null };
  config: { path: string | null; connections: number; usable: number };
  queue: { running: number; queued: number; max: number; timeoutMs: number };
  localOnly: boolean;
  store: string;
}

export interface AppConfig {
  chains: ChainInfo[];
  entryPoints: EntryPointInfo[];
  connections: (ConnectionInfo & { available: boolean; problem: string | null })[];
  fixtures: FixtureInfo[];
}

export type ValidateResult =
  | { ok: false; issues: InputIssue[] }
  | { ok: true; format: string; warnings: string[]; chainId: number | null; entryPoint: string | null; userOpHash: string | null; requiredPrefund: string; paymaster: string | null; factory: string | null };

export class ApiError extends Error {
  constructor(message: string, public status: number, public issues?: InputIssue[]) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = init?.body ? { "content-type": "application/json" } : {};
  const r = await fetch(path, { ...init, headers });
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(body.error ?? `HTTP ${r.status}`, r.status, body.issues);
  return body as T;
}

export const api = {
  health: () => req<Health>("/api/health"),
  config: () => req<AppConfig>("/api/config"),
  sessions: () => req<SessionSummary[]>("/api/sessions?limit=40"),
  session: (id: string) => req<Session>(`/api/sessions/${id}`),
  validate: (body: { userOp: unknown; chainId?: number; entryPoint?: string }) => req<ValidateResult>("/api/validate", { method: "POST", body: JSON.stringify(body) }),
  start: (body: InspectRequest) => req<{ id: string }>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),
  runFixture: (id: string) => req<{ id: string }>(`/api/fixtures/${id}/run`, { method: "POST" }),
  replay: (id: string) => req<{ id: string }>(`/api/sessions/${id}/replay`, { method: "POST" }),
  remove: (id: string) => req<void>(`/api/sessions/${id}`, { method: "DELETE" }),
  bundleUrl: (id: string) => `/api/sessions/${id}/bundle.zip`,
};
