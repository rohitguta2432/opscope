import type { Evidence, InspectRequest } from "@opscope/core";
import type { Diagnosis } from "./types";

export type SessionStatus = "queued" | "running" | "done" | "error";

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  label: string;
  source: "fixture" | "live" | "bundle";
  demo: boolean;
  status: SessionStatus;
  progress: { step: string; at: number }[];
  chainId: number;
  code?: string;
  stage?: string;
  verdict?: Diagnosis["verdict"];
  request: InspectRequest;
  evidence?: Evidence;
  diagnosis?: Diagnosis;
  error?: string;
  durationMs?: number;
  /** session this one re-ran */
  replayOf?: string;
}

export type SessionSummary = Omit<Session, "evidence" | "diagnosis" | "request"> & { userOpHash?: string };

export const reproduceCommand = (sessionId: string) => `opscope replay ./opscope-${sessionId}`;
