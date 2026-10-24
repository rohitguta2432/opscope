import { createPublicClient, http, isHex, type Address, type Hex, type PublicClient } from "viem";

export type Client = PublicClient;

export function clientFor(url: string, timeoutMs = 20_000): Client {
  return createPublicClient({ transport: http(url, { timeout: timeoutMs, retryCount: 1 }) }) as Client;
}

export type BlockRef = bigint | "latest";
const tag = (b: BlockRef) => (b === "latest" ? "latest" : `0x${b.toString(16)}`);

export interface CallParams {
  from?: Address;
  to: Address;
  data: Hex;
  gas?: bigint;
  value?: bigint;
  block?: BlockRef;
  /** eth_call state override set: { [address]: { code?, balance?, state? } } */
  stateOverride?: Record<string, { code?: Hex; balance?: Hex }>;
}

export type CallResult = { ok: true; data: Hex } | { ok: false; data?: Hex; message: string; rpcError?: boolean };

function txObject(p: CallParams) {
  const tx: Record<string, string> = { to: p.to, data: p.data };
  if (p.from) tx.from = p.from;
  if (p.gas !== undefined) tx.gas = `0x${p.gas.toString(16)}`;
  if (p.value !== undefined) tx.value = `0x${p.value.toString(16)}`;
  return tx;
}

/**
 * eth_call that keeps revert data. viem's high-level call() wraps errors in a way
 * that sometimes loses the raw bytes; for diagnosis the bytes are the evidence.
 */
export async function rawCall(client: Client, p: CallParams): Promise<CallResult> {
  const params: unknown[] = [txObject(p), tag(p.block ?? "latest")];
  if (p.stateOverride) params.push(p.stateOverride);
  try {
    const data = (await client.request({ method: "eth_call", params } as never)) as Hex;
    return { ok: true, data };
  } catch (e) {
    const data = findRevertData(e);
    const message = errorMessage(e);
    return { ok: false, data, message, rpcError: data === undefined && !/revert/i.test(message) };
  }
}

export function findRevertData(e: unknown): Hex | undefined {
  const seen = new Set<unknown>();
  const walk = (x: unknown, depth: number): Hex | undefined => {
    if (!x || typeof x !== "object" || seen.has(x) || depth > 8) return undefined;
    seen.add(x);
    const o = x as Record<string, unknown>;
    if (typeof o.data === "string" && isHex(o.data)) return o.data as Hex;
    if (o.data && typeof o.data === "object") {
      const d = o.data as Record<string, unknown>;
      if (typeof d.data === "string" && isHex(d.data)) return d.data as Hex;
    }
    return walk(o.cause, depth + 1) ?? walk(o.error, depth + 1);
  };
  return walk(e, 0);
}

export function errorMessage(e: unknown): string {
  const o = e as { shortMessage?: string; details?: string; message?: string };
  return (o?.details || o?.shortMessage || o?.message || String(e)).split("\n")[0]!.slice(0, 400);
}

export async function rpc<T>(client: Client, method: string, params: unknown[] = []): Promise<T> {
  return (await client.request({ method, params } as never)) as T;
}

export interface CallTracerFrame {
  type: string;
  from: string;
  to?: string;
  value?: string;
  gas?: string;
  gasUsed?: string;
  input: string;
  output?: string;
  error?: string;
  revertReason?: string;
  calls?: CallTracerFrame[];
}

export async function traceCall(client: Client, p: CallParams): Promise<{ ok: true; frame: CallTracerFrame } | { ok: false; reason: string }> {
  try {
    const opts: Record<string, unknown> = { tracer: "callTracer" };
    if (p.stateOverride) opts.stateOverrides = p.stateOverride;
    const frame = await rpc<CallTracerFrame>(client, "debug_traceCall", [txObject(p), tag(p.block ?? "latest"), opts]);
    return { ok: true, frame };
  } catch (e) {
    return { ok: false, reason: `debug_traceCall unavailable: ${errorMessage(e)}` };
  }
}

export async function traceTransaction(client: Client, hash: Hex): Promise<{ ok: true; frame: CallTracerFrame } | { ok: false; reason: string }> {
  try {
    const frame = await rpc<CallTracerFrame>(client, "debug_traceTransaction", [hash, { tracer: "callTracer" }]);
    return { ok: true, frame };
  } catch (e) {
    return { ok: false, reason: `debug_traceTransaction unavailable: ${errorMessage(e)}` };
  }
}

/** Sends from an unlocked/impersonated Anvil account and waits for the receipt. Local chains only. */
export async function sendAndWait(
  client: Client,
  tx: { from: Address; to?: Address; data: Hex; value?: bigint; gas?: bigint; nonce?: number; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint },
  opts: { wait?: boolean } = {},
) {
  const obj: Record<string, string> = { from: tx.from, data: tx.data };
  if (tx.to) obj.to = tx.to;
  if (tx.value !== undefined) obj.value = `0x${tx.value.toString(16)}`;
  if (tx.gas !== undefined) obj.gas = `0x${tx.gas.toString(16)}`;
  if (tx.nonce !== undefined) obj.nonce = `0x${tx.nonce.toString(16)}`;
  if (tx.maxFeePerGas !== undefined) obj.maxFeePerGas = `0x${tx.maxFeePerGas.toString(16)}`;
  if (tx.maxPriorityFeePerGas !== undefined) obj.maxPriorityFeePerGas = `0x${tx.maxPriorityFeePerGas.toString(16)}`;
  const hash = await rpc<Hex>(client, "eth_sendTransaction", [obj]);
  if (opts.wait === false) return { hash, receipt: undefined };
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 50, timeout: 30_000 });
  return { hash, receipt };
}
