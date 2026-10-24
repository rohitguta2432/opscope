import { decodeFunctionData, erc20Abi, parseEventLogs, type Address, type Hex, type Log, type TransactionReceipt } from "viem";
import {
  decodeRevert,
  getUserOpHashV07,
  requiredGas,
  sameAddress,
  unpackUserOp,
  type ExecutionContext,
  type PackedUserOperation,
  type ReplayEvidence,
  type UserOperationV07,
} from "@opscope/core";
import { startAnvil, type AnvilHandle } from "./anvil";
import { artifacts } from "./artifacts";
import { handleOpsData, DEV } from "./fixtures";
import { clientFor, rawCall, rpc, sendAndWait, traceCall, traceTransaction, type Client } from "./rpc";
import { normalizeTrace, type Roles } from "./trace";

export interface ForkSession {
  anvil: AnvilHandle;
  client: Client;
  mode: "fork-at-block" | "fork-after-transaction";
  forkBlock: bigint;
  forkAfterTx?: Hex;
  stop(): Promise<void>;
}

export type ForkPin =
  | { kind: "block"; number: bigint }
  /** exact pre-state of an included transaction: after its predecessor in the block, or the end of the previous block */
  | { kind: "before-tx"; blockNumber: bigint; precedingTx?: Hex };

export async function openFork(sourceUrl: string, pin: ForkPin, opts: { anvilPath?: string; signal?: AbortSignal } = {}): Promise<ForkSession> {
  const anvil =
    pin.kind === "block"
      ? await startAnvil({ anvilPath: opts.anvilPath, forkUrl: sourceUrl, forkBlockNumber: pin.number, signal: opts.signal })
      : pin.precedingTx
        ? await startAnvil({ anvilPath: opts.anvilPath, forkUrl: sourceUrl, forkTransactionHash: pin.precedingTx, signal: opts.signal })
        : await startAnvil({ anvilPath: opts.anvilPath, forkUrl: sourceUrl, forkBlockNumber: pin.blockNumber - 1n, signal: opts.signal });
  const client = clientFor(anvil.url, 60_000);
  return {
    anvil,
    client,
    mode: pin.kind === "before-tx" && pin.precedingTx ? "fork-after-transaction" : "fork-at-block",
    forkBlock: pin.kind === "block" ? pin.number : pin.blockNumber - 1n,
    forkAfterTx: pin.kind === "before-tx" ? pin.precedingTx : undefined,
    stop: () => anvil.stop(),
  };
}

type Ctx = ExecutionContext["replay"];

interface ReplayArgs {
  fork: ForkSession;
  op: UserOperationV07;
  entryPoint: Address;
  chainId: number;
  labels: Record<string, string>;
  roles: Roles;
  replayCtx: Ctx;
}

/** handleOps gas the replay gives a pending op: every op limit plus EntryPoint overhead. Real bundlers pick their own. */
export const replayGasLimit = (op: UserOperationV07) => {
  const g = (requiredGas(op) * 11n) / 10n + 300_000n;
  return g > 30_000_000n ? 30_000_000n : g;
};

/** Replays a not-yet-included operation as the next block on the fork, from an Anvil dev account acting as bundler. */
export async function replayPending(a: ReplayArgs, forkBlockTimestamp: bigint): Promise<ReplayEvidence> {
  const { fork, op, entryPoint } = a;
  const data = handleOpsData([op], DEV.bundler);
  const gas = replayGasLimit(op);
  a.replayCtx.handleOps = { from: DEV.bundler, beneficiary: DEV.bundler, gasLimit: gas.toString(), note: "Anvil dev account #0 acts as bundler and beneficiary. Gas limit chosen by OpScope: Σ op limits × 1.1 + 300k." };
  const nextTs = forkBlockTimestamp + 12n;
  await rpc(fork.client, "evm_setNextBlockTimestamp", [`0x${nextTs.toString(16)}`]);
  a.replayCtx.blockEnv.push({ field: "timestamp", value: nextTs.toString(), reason: "Pinned block + 12 s, as if the operation were in the next block." });
  a.replayCtx.blockEnv.push({ field: "baseFeePerGas", value: "derived", reason: "Anvil derives the next base fee from the pinned block (EIP-1559)." });

  const call = await rawCall(fork.client, { from: DEV.bundler, to: entryPoint, data, gas });
  if (!call.ok) {
    if (!call.data) {
      return { ran: true, status: "error", note: `handleOps eth_call failed without revert data: ${call.message}`, trace: { status: "unavailable", reason: "No trace: the call failed before execution." } };
    }
    const t = await traceCall(fork.client, { from: DEV.bundler, to: entryPoint, data, gas });
    return {
      ran: true,
      status: "validation-reverted",
      handleOpsCall: { status: "reverted", revert: decodeRevert(call.data) },
      trace: t.ok ? { status: "ok", method: "debug_traceCall", root: normalizeTrace(t.frame, a.labels, a.roles) } : { status: "unavailable", reason: t.reason },
    };
  }

  const { hash, receipt } = await sendAndWait(fork.client, { from: DEV.bundler, to: entryPoint, data, gas });
  const out = await collect(a, hash, receipt!);
  out.handleOpsCall = { status: "ok" };
  return out;
}

export interface OriginalInclusion {
  tx: { hash: Hex; from: Address; to: Address; input: Hex; gas: bigint; nonce: number; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint; type: string };
  block: { number: bigint; timestamp: bigint; baseFeePerGas?: bigint; miner: Address };
  receipt: TransactionReceipt;
}

/** Re-executes the original bundle transaction from its sender on the exact pre-transaction state, then compares. */
export async function replayIncluded(a: ReplayArgs, orig: OriginalInclusion): Promise<ReplayEvidence> {
  const { fork } = a;
  const c = fork.client;
  const details: string[] = [];
  await rpc(c, "anvil_impersonateAccount", [orig.tx.from]);
  a.replayCtx.stateOverrides.push({ address: orig.tx.from, kind: "impersonation", detail: "anvil_impersonateAccount", purpose: "Send the original bundle transaction from its original sender.", scope: "replay fork" });
  await rpc(c, "evm_setNextBlockTimestamp", [`0x${orig.block.timestamp.toString(16)}`]);
  a.replayCtx.blockEnv.push({ field: "timestamp", value: orig.block.timestamp.toString(), reason: "Original inclusion block timestamp." });
  if (orig.block.baseFeePerGas !== undefined) {
    await rpc(c, "anvil_setNextBlockBaseFeePerGas", [`0x${orig.block.baseFeePerGas.toString(16)}`]);
    a.replayCtx.blockEnv.push({ field: "baseFeePerGas", value: orig.block.baseFeePerGas.toString(), reason: "Original inclusion block base fee (sets the operation's gas price)." });
  }
  await rpc(c, "anvil_setCoinbase", [orig.block.miner]);
  a.replayCtx.blockEnv.push({ field: "coinbase", value: orig.block.miner, reason: "Original block producer." });

  const nonceOnFork = await c.getTransactionCount({ address: orig.tx.from });
  details.push(nonceOnFork === orig.tx.nonce ? `Bundler nonce on fork = ${nonceOnFork}, same as the original transaction (pre-state consistent).` : `Bundler nonce on fork is ${nonceOnFork}, original used ${orig.tx.nonce} — fork state differs from the original pre-state.`);

  a.replayCtx.handleOps = { from: orig.tx.from, beneficiary: beneficiaryOf(orig.tx.input) ?? orig.tx.from, gasLimit: orig.tx.gas.toString(), note: "Original bundle transaction re-sent unchanged (same sender, calldata, gas and fees)." };
  const fees = orig.tx.maxFeePerGas !== undefined ? { maxFeePerGas: orig.tx.maxFeePerGas, maxPriorityFeePerGas: orig.tx.maxPriorityFeePerGas } : {};
  const { hash, receipt } = await sendAndWait(c, { from: orig.tx.from, to: orig.tx.to, data: orig.tx.input, gas: orig.tx.gas, nonce: nonceOnFork, ...fees });
  const out = await collect(a, hash, receipt!);

  const same = compareReceipts(orig.receipt, receipt!, details);
  out.comparison = { identical: same, details };
  return out;
}

async function collect(a: ReplayArgs, hash: Hex, receipt: TransactionReceipt): Promise<ReplayEvidence> {
  const userOpHash = getUserOpHashV07(a.op, a.entryPoint, a.chainId);
  const logs = parseEventLogs({ abi: artifacts.EntryPoint.abi, logs: receipt.logs as Log[] }) as unknown as { eventName: string; args: Record<string, unknown> }[];
  const mine = logs.filter((l) => String(l.args?.userOpHash ?? "").toLowerCase() === userOpHash.toLowerCase());
  const ev = mine.find((l) => l.eventName === "UserOperationEvent");
  const rr = mine.find((l) => l.eventName === "UserOperationRevertReason");
  const pr = mine.find((l) => l.eventName === "PostOpRevertReason");
  const dep = mine.find((l) => l.eventName === "AccountDeployed");
  const low = mine.find((l) => l.eventName === "UserOperationPrefundTooLow");
  const t = await traceTransaction(a.fork.client, hash);

  const out: ReplayEvidence = {
    ran: true,
    status: receipt.status === "success" ? "executed" : "tx-reverted",
    tx: { hash, status: receipt.status, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber.toString(), from: receipt.from, gasLimit: "" },
    trace: t.ok ? { status: "ok", method: "debug_traceTransaction", root: normalizeTrace(t.frame, a.labels, a.roles) } : { status: "unavailable", reason: t.reason },
  };
  if (ev) {
    out.userOpEvent = {
      success: Boolean(ev.args.success),
      actualGasCost: String(ev.args.actualGasCost),
      actualGasUsed: String(ev.args.actualGasUsed),
      nonce: String(ev.args.nonce),
      paymaster: ev.args.paymaster as Address,
    };
  } else if (receipt.status === "success") {
    out.note = "The bundle transaction succeeded but emitted no UserOperationEvent for this userOpHash.";
  }
  if (rr) out.revertReason = decodeRevert(rr.args.revertReason as Hex);
  if (pr) out.postOpRevertReason = decodeRevert(pr.args.revertReason as Hex);
  if (dep) out.accountDeployed = { factory: dep.args.factory as Address };
  if (low) out.prefundTooLow = true;
  const tx = await a.fork.client.getTransaction({ hash });
  out.tx!.gasLimit = tx.gas.toString();
  return out;
}

function beneficiaryOf(input: Hex): Address | undefined {
  try {
    const d = decodeFunctionData({ abi: artifacts.EntryPoint.abi, data: input });
    return d.functionName === "handleOps" ? ((d.args as unknown[])[1] as Address) : undefined;
  } catch {
    return undefined;
  }
}

/** Finds the operation inside an included handleOps transaction. */
export function findOpInBundle(input: Hex, entryPoint: Address, chainId: number, userOpHash: Hex): { index: number; total: number; op?: UserOperationV07 } {
  try {
    const d = decodeFunctionData({ abi: artifacts.EntryPoint.abi, data: input });
    if (d.functionName !== "handleOps") return { index: -1, total: 0 };
    const ops = (d.args as unknown[])[0] as PackedUserOperation[];
    const index = ops.findIndex((p) => sameAddress(getUserOpHashV07(unpackUserOp(p), entryPoint, chainId), userOpHash));
    return { index, total: ops.length, op: index >= 0 ? unpackUserOp(ops[index]!) : undefined };
  } catch {
    return { index: -1, total: 0 };
  }
}

function compareReceipts(orig: TransactionReceipt, replay: TransactionReceipt, details: string[]): boolean {
  let same = true;
  if (orig.status !== replay.status) {
    same = false;
    details.push(`Status differs: original ${orig.status}, replay ${replay.status}.`);
  }
  if (orig.gasUsed === replay.gasUsed) details.push(`gasUsed ${replay.gasUsed} — identical to the original receipt.`);
  else {
    same = false;
    details.push(`gasUsed differs: original ${orig.gasUsed}, replay ${replay.gasUsed}.`);
  }
  const key = (l: Log) => `${l.address.toLowerCase()}|${l.topics.join(",")}|${l.data}`;
  const a = orig.logs.map(key);
  const b = replay.logs.map(key);
  const matching = a.filter((k, i) => b[i] === k).length;
  if (a.length === b.length && matching === a.length) details.push(`${a.length}/${a.length} logs identical (address, topics, data, order).`);
  else {
    same = false;
    details.push(`Logs differ: ${matching}/${Math.max(a.length, b.length)} match.`);
  }
  return same;
}

/** symbol()/decimals() for tokens the operation calls, read on the fork. */
export async function readTokens(client: Client, targets: Address[]): Promise<Record<string, { symbol: string; decimals: number }>> {
  const out: Record<string, { symbol: string; decimals: number }> = {};
  for (const t of targets) {
    try {
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }),
        client.readContract({ address: t, abi: erc20Abi, functionName: "decimals" }),
      ]);
      out[t] = { symbol, decimals };
    } catch {
      /* not an ERC-20 */
    }
  }
  return out;
}
