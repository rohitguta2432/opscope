import { getAddress, hexToBigInt, isHex, type Address, type Hex } from "viem";
import { decodeCall, decodeRevert, type TraceFrame } from "@opscope/core";
import type { CallTracerFrame } from "./rpc";

export type Roles = Record<string, NonNullable<TraceFrame["role"]>>;

const PRECOMPILES: Record<string, string> = {
  "0x0000000000000000000000000000000000000001": "ecrecover",
  "0x0000000000000000000000000000000000000002": "sha256",
  "0x0000000000000000000000000000000000000003": "ripemd160",
  "0x0000000000000000000000000000000000000004": "identity",
  "0x0000000000000000000000000000000000000005": "modexp",
};

const dec = (v?: string) => (v && isHex(v) ? hexToBigInt(v).toString() : v);

/** callTracer output → OpScope trace tree with decoded calls, reverts, labels and roles. */
export function normalizeTrace(frame: CallTracerFrame, labels: Record<string, string>, roles: Roles, id = "0", depth = 0): TraceFrame {
  const to = frame.to ? (getAddress(frame.to) as Address) : undefined;
  const key = to?.toLowerCase() ?? "";
  const precompile = PRECOMPILES[key];
  const reverted = !!frame.error;
  const out: TraceFrame = {
    id,
    type: frame.type,
    from: getAddress(frame.from),
    to,
    value: dec(frame.value),
    gas: dec(frame.gas),
    gasUsed: dec(frame.gasUsed),
    input: (frame.input || "0x") as Hex,
    output: frame.output as Hex | undefined,
    error: frame.error,
    depth,
    label: precompile ?? (to ? labelFor(labels, to) : undefined),
    role: precompile ? "precompile" : (roles[key] ?? "other"),
    status: reverted ? "reverted" : "ok",
    calls: [],
  };
  if (!precompile) out.decoded = decodeCall(out.input);
  if (reverted) out.revert = decodeRevert(out.output);
  out.calls = (frame.calls ?? []).map((c, i) => normalizeTrace(c, labels, roles, `${id}.${i}`, depth + 1));
  return out;
}

function labelFor(labels: Record<string, string>, addr: string) {
  const hit = Object.entries(labels).find(([k]) => k.toLowerCase() === addr.toLowerCase());
  return hit?.[1];
}

export function walk(root: TraceFrame, fn: (f: TraceFrame) => void) {
  fn(root);
  for (const c of root.calls) walk(c, fn);
}

/** Deepest reverted frame whose output matches the given revert data (or any, if none given). */
export function deepestRevert(root: TraceFrame, data?: Hex): TraceFrame | undefined {
  let best: TraceFrame | undefined;
  walk(root, (f) => {
    if (f.status !== "reverted") return;
    if (data && f.output?.toLowerCase() !== data.toLowerCase()) return;
    if (!best || f.depth > best.depth) best = f;
  });
  return best;
}
