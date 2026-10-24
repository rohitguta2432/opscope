import { erc20Abi, getAddress, type Address, type Hex } from "viem";
import {
  OPSCOPE_VERSION,
  SENDER_CREATOR_V07,
  chainName,
  decodeCall,
  findEntryPoint,
  getUserOpHashV07,
  packUserOp,
  packedToHex,
  parseUserOpInput,
  redactDeep,
  sameAddress,
  toRpcUserOp,
  type Evidence,
  type ExecutionContext,
  type InputIssue,
  type InspectRequest,
  type PreflightEvidence,
  type ReplayEvidence,
  type ToolError,
  type UserOperationV07,
} from "@opscope/core";
import { diagnose, type Diagnosis } from "@opscope/diagnosis";
import { anvilVersion } from "./anvil";
import { findConnection, type LoadedConfig } from "./config";
import { readCodeContext } from "./context";
import { DEV, FIXTURES, buildFixture, type FixtureEnv } from "./fixtures";
import { runPreflight } from "./preflight";
import { findOpInBundle, openFork, readTokens, replayIncluded, replayPending, type ForkSession, type OriginalInclusion } from "./replay";
import { clientFor, errorMessage, type Client } from "./rpc";
import type { Roles } from "./trace";

export class InspectInputError extends Error {
  constructor(public issues: InputIssue[]) {
    super(`Invalid UserOperation: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    this.name = "InspectInputError";
  }
}

export interface InspectOptions {
  config: LoadedConfig;
  progress?: (step: string) => void;
  signal?: AbortSignal;
}

export interface InspectOutcome {
  evidence: Evidence;
  diagnosis: Diagnosis;
  source: "fixture" | "live";
  demo: boolean;
}

const NOT_RUN_TRACE = { status: "unavailable" as const, reason: "Replay did not run." };

/**
 * Pins the chain context, runs the bundler-style preflight and an isolated Anvil replay,
 * then hands the evidence to the diagnosis package. Every outcome is derived from an RPC or
 * EVM result produced during this call; nothing is synthesised.
 */
export async function inspect(req: InspectRequest, opts: InspectOptions): Promise<InspectOutcome> {
  const step = (s: string) => opts.progress?.(s);
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const time = async <T>(k: string, f: () => Promise<T>) => {
    const s = Date.now();
    try {
      return await f();
    } finally {
      timings[k] = Date.now() - s;
    }
  };

  let fixture: FixtureEnv | undefined;
  let fork: ForkSession | undefined;
  try {
    const anvilPath = opts.config.config.replay.anvilPath;
    if (req.connection.kind === "fixture") {
      const fid = req.connection.fixtureId;
      step("Building fixture chain");
      fixture = await time("fixture", () => buildFixture(fid, { anvilPath, signal: opts.signal }));
    }

    // a fixture's included operation: "0x" stands for the fixture's own inclusion transaction
    const block: InspectRequest["block"] =
      fixture?.inclusionTx && req.block.kind === "inclusion" && req.block.txHash === "0x" ? { kind: "inclusion", txHash: fixture.inclusionTx } : req.block;

    let op: UserOperationV07;
    let inputWarnings: string[] = [];
    if (req.userOp == null && fixture) op = fixture.userOp;
    else {
      const parsed = parseUserOpInput(req.userOp);
      if (!parsed.ok) throw new InspectInputError(parsed.issues);
      op = parsed.op;
      inputWarnings = parsed.warnings;
      if (fixture && getUserOpHashV07(op, req.entryPoint, req.chainId) !== getUserOpHashV07(fixture.userOp, req.entryPoint, req.chainId)) {
        inputWarnings.push("This operation differs from the fixture's own operation; replaying it against the fixture chain as submitted.");
      }
    }

    const entryPoint = getAddress(req.entryPoint);
    const userOpHash = getUserOpHashV07(op, entryPoint, req.chainId);
    const errors: ToolError[] = [];
    const labels: Record<string, string> = { [entryPoint]: "EntryPoint v0.7", [SENDER_CREATOR_V07]: "SenderCreator", [op.sender]: "Smart account", ...(fixture?.labels ?? {}) };
    if (op.paymaster) labels[op.paymaster] ??= "Paymaster";
    if (op.factory) labels[op.factory] ??= "Factory";
    const call = decodeCall(op.callData);
    const targets = (call?.inner ?? []).map((i) => getAddress(i.target));
    for (const t of targets) labels[t] ??= "Call target";
    const roles: Roles = { [entryPoint.toLowerCase()]: "entrypoint", [op.sender.toLowerCase()]: "account", [SENDER_CREATOR_V07.toLowerCase()]: "senderCreator" };
    if (op.paymaster) roles[op.paymaster.toLowerCase()] = "paymaster";
    if (op.factory) roles[op.factory.toLowerCase()] = "factory";
    for (const t of targets) roles[t.toLowerCase()] ??= "target";

    const av = await anvilVersion(anvilPath);
    const context: ExecutionContext = {
      chain: { id: req.chainId, name: chainName(req.chainId) },
      block: { number: "—", hash: "0x", timestamp: "—", pinnedBy: block.kind },
      entryPoint: { address: entryPoint, version: "unknown", canonical: false, note: "Not read." },
      account: { address: op.sender, deployed: false },
      connection: fixture
        ? { id: `fixture:${fixture.info.id}`, kind: "fixture", host: "local Anvil (127.0.0.1)" }
        : { id: req.connection.kind === "rpc" ? req.connection.id : "?", kind: "rpc", host: "—" },
      replay: { engine: "anvil", anvilVersion: av, mode: "not-run", precedingTxs: 0, exactness: "not-run", approximations: [], stateOverrides: [], blockEnv: [] },
      tools: { opscope: OPSCOPE_VERSION, node: process.version, anvil: av },
      fixture: fixture ? { id: fixture.info.id, version: fixture.info.version, title: fixture.info.title } : undefined,
    };

    const finish = (preflight: PreflightEvidence, replay: ReplayEvidence, tokens: Evidence["tokens"] = {}, balances: Evidence["balances"] = []): InspectOutcome => {
      timings.total = Date.now() - t0;
      const evidence: Evidence = redactDeep(
        {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          chainId: req.chainId,
          entryPoint,
          userOp: toRpcUserOp(op),
          packed: packedToHex(packUserOp(op)),
          userOpHash,
          inputWarnings,
          context,
          preflight,
          replay,
          errors,
          labels,
          tokens,
          balances,
          timings,
        },
        opts.config.secrets,
      );
      step("Diagnosing");
      return { evidence, diagnosis: diagnose(evidence), source: fixture ? "fixture" : "live", demo: !!fixture?.info.demo };
    };
    const emptyPreflight = (why: string): PreflightEvidence => ({ ran: false, target: why, checks: [], simulateValidation: { status: "unavailable", reason: why }, userOpHash: { local: userOpHash }, reads: {} });
    const skippedReplay = (why: string): ReplayEvidence => ({ ran: false, status: "skipped", note: why, trace: NOT_RUN_TRACE });
    const configError = (e: ToolError) => {
      errors.push(e);
      return finish(emptyPreflight(e.message), skippedReplay(e.message));
    };

    // ── configuration ────────────────────────────────────────────
    const epInfo = findEntryPoint(entryPoint);
    if (epInfo && !epInfo.supported) {
      return configError({ code: "UNSUPPORTED_ENTRYPOINT", stage: "rpc", message: `${epInfo.label} (${entryPoint}) is not supported. OpScope's MVP replays EntryPoint v0.7 only.` });
    }
    let url: string;
    if (fixture) url = fixture.anvil.url;
    else {
      const id = req.connection.kind === "rpc" ? req.connection.id : "";
      const conn = findConnection(opts.config, id);
      if (!conn) return configError({ code: "CONNECTION_NOT_FOUND", stage: "rpc", message: `No RPC connection "${id}" in the server config.` });
      context.connection.host = conn.info.host;
      if (!conn.url) return configError({ code: "CONNECTION_UNAVAILABLE", stage: "rpc", message: `Connection "${id}" can't be used: ${conn.problem}` });
      if (conn.info.chainId !== req.chainId) return configError({ code: "CHAIN_MISMATCH", stage: "rpc", message: `Connection "${id}" is configured for chain ${conn.info.chainId}, but the operation targets chain ${req.chainId}.` });
      url = conn.url;
    }

    // ── RPC: chain id + block pin ────────────────────────────────
    step("Connecting to RPC");
    const client = clientFor(url);
    let remoteChain: number;
    try {
      remoteChain = await time("chainId", () => client.getChainId());
    } catch (e) {
      return configError({ code: "RPC_UNREACHABLE", stage: "rpc", message: "The RPC endpoint did not answer eth_chainId.", detail: errorMessage(e) });
    }
    if (remoteChain !== req.chainId) {
      return configError({ code: "CHAIN_MISMATCH", stage: "rpc", message: `RPC reports chain ${remoteChain}; the operation targets chain ${req.chainId}.` });
    }

    step("Pinning block");
    let inclusion: OriginalInclusion | undefined;
    let pinBlock: bigint;
    try {
      if (block.kind === "inclusion") {
        const txHash = block.txHash as Hex;
        const tx = await client.getTransaction({ hash: txHash }).catch(() => undefined);
        if (!tx || tx.blockNumber == null) return configError({ code: "TX_NOT_FOUND", stage: "rpc", message: `Inclusion transaction ${txHash} was not found (or is still pending) on chain ${req.chainId}.` });
        if (!sameAddress(tx.to, entryPoint)) return configError({ code: "INCLUSION_NOT_ENTRYPOINT", stage: "rpc", message: `Transaction ${txHash} calls ${tx.to}, not the EntryPoint ${entryPoint}.` });
        const found = findOpInBundle(tx.input, entryPoint, req.chainId, userOpHash);
        if (found.index < 0) return configError({ code: "INCLUSION_OP_NOT_FOUND", stage: "rpc", message: `Transaction ${txHash} is a bundle of ${found.total} operation(s), none with userOpHash ${userOpHash}.` });
        const [blk, receipt] = await Promise.all([client.getBlock({ blockNumber: tx.blockNumber }), client.getTransactionReceipt({ hash: txHash })]);
        const idx = tx.transactionIndex ?? 0;
        const precedingTx = idx > 0 ? (blk.transactions[idx - 1] as Hex) : undefined;
        inclusion = {
          tx: { hash: txHash, from: tx.from, to: tx.to!, input: tx.input, gas: tx.gas, nonce: tx.nonce, maxFeePerGas: tx.maxFeePerGas ?? undefined, maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? undefined, gasPrice: tx.gasPrice ?? undefined, type: tx.type },
          block: { number: blk.number!, timestamp: blk.timestamp, baseFeePerGas: blk.baseFeePerGas ?? undefined, miner: blk.miner },
          receipt,
        };
        context.inclusion = { txHash, blockNumber: blk.number!.toString(), txIndex: idx, from: tx.from, precedingTx };
        if (found.total > 1 && found.index > 0) context.replay.approximations.push(`The operation is #${found.index + 1} of ${found.total} in its bundle; the whole bundle is re-executed, so earlier operations apply first, as on-chain.`);
        context.block = { number: blk.number!.toString(), hash: blk.hash!, timestamp: blk.timestamp.toString(), baseFeePerGas: blk.baseFeePerGas?.toString(), pinnedBy: "inclusion" };
        pinBlock = blk.number! - 1n;
      } else {
        const b = block.kind === "latest" ? await client.getBlock({ blockTag: "latest" }) : await client.getBlock({ blockNumber: BigInt(block.number) });
        if (block.kind === "number" && block.hash && b.hash?.toLowerCase() !== block.hash.toLowerCase()) {
          return configError({ code: "BLOCK_HASH_MISMATCH", stage: "rpc", message: `Block ${b.number} has hash ${b.hash} on this RPC, not the pinned ${block.hash}. Reorg, or a different chain.` });
        }
        context.block = { number: b.number!.toString(), hash: b.hash!, timestamp: b.timestamp.toString(), baseFeePerGas: b.baseFeePerGas?.toString(), pinnedBy: block.kind };
        pinBlock = b.number!;
      }
    } catch (e) {
      return configError({ code: "BLOCK_NOT_FOUND", stage: "rpc", message: "Could not read the requested block.", detail: errorMessage(e) });
    }

    // ── replay environment ───────────────────────────────────────
    const wantReplay = req.mode === "preflight+replay";
    let replayBlocked: string | undefined;
    if (wantReplay && !av) replayBlocked = `anvil not found at "${anvilPath}"; local replay unavailable.`;
    if (wantReplay && !replayBlocked) {
      step("Starting isolated Anvil fork");
      try {
        fork = await time("fork", () =>
          openFork(url, inclusion ? { kind: "before-tx", blockNumber: inclusion.block.number, precedingTx: context.inclusion?.precedingTx } : { kind: "block", number: pinBlock }, { anvilPath, signal: opts.signal }),
        );
        context.replay.mode = fork.mode;
        context.replay.forkBlock = fork.forkBlock.toString();
        context.replay.forkAfterTx = fork.forkAfterTx;
        context.replay.precedingTxs = context.inclusion?.txIndex ?? 0;
      } catch (e) {
        replayBlocked = `Could not start the Anvil fork: ${errorMessage(e)}`;
      }
    }

    // preflight reads: exact pre-tx state lives on the fork for included ops
    const preClient: Client = inclusion && fork ? fork.client : client;
    const preBlock = inclusion && fork ? ("latest" as const) : pinBlock;
    step("Reading code identities");
    const code = await time("context", () => readCodeContext(preClient, op, entryPoint, preBlock));
    Object.assign(context, code);
    if (code.account.implementation?.known) {
      labels[op.sender] = code.account.implementation.label.replace(/ v[\d.]+.*$/, "");
      if (code.account.implementation.address) {
        labels[code.account.implementation.address] = `${labels[op.sender]} implementation`;
        roles[code.account.implementation.address.toLowerCase()] = "account";
      }
    }
    if (code.paymaster?.deployed && fixture) code.paymaster.label = labels[op.paymaster!];

    step("Running bundler preflight");
    const preTarget = inclusion && fork ? `Anvil fork, state before transaction ${inclusion.tx.hash.slice(0, 10)}…` : `RPC at block ${pinBlock}`;
    if (inclusion && !fork && (context.inclusion?.txIndex ?? 0) > 0) {
      context.replay.approximations.push(`Preflight read state at the end of block ${pinBlock}; ${context.inclusion!.txIndex} earlier transaction(s) in block ${inclusion.block.number} are not applied.`);
    }
    const blockTs = BigInt(inclusion ? inclusion.block.timestamp - 12n : BigInt(context.block.timestamp));
    const preflight = await time("preflight", () =>
      runPreflight({
        client: preClient,
        op,
        entryPoint,
        chainId: req.chainId,
        block: preBlock,
        blockTimestamp: blockTs,
        baseFeePerGas: context.block.baseFeePerGas ? BigInt(context.block.baseFeePerGas) : undefined,
        target: inclusion && fork ? "fork" : "rpc",
        targetLabel: preTarget,
        code,
        labels,
      }),
    );
    context.replay.stateOverrides.push({
      address: entryPoint,
      kind: "code",
      detail: "EntryPointSimulations v0.7.0 runtime code (from @account-abstraction/contracts@0.7.0)",
      purpose: "simulateValidation, the same eth_call state override v0.7 bundlers use.",
      scope: "preflight eth_call",
    });

    if (!wantReplay) {
      context.replay.exactness = "not-run";
      return finish(preflight, skippedReplay("Preflight-only run; local replay not requested."), await readTokens(client, targets));
    }
    if (!fork) {
      return finish(preflight, { ran: false, status: "skipped", note: replayBlocked, trace: { status: "unavailable", reason: replayBlocked ?? "Replay unavailable." } }, await readTokens(client, targets));
    }

    // token balances before the op (fork) vs at the start of its block (RPC): exposes earlier txs in the same block
    const balances: Evidence["balances"] = [];
    for (const t of targets) {
      const before = await tokenBalance(fork.client, t, op.sender, "latest");
      if (before === undefined) continue;
      balances.push({ token: t, holder: op.sender, beforeOp: before, atBlockStart: inclusion ? await tokenBalance(client, t, op.sender, pinBlock) : undefined });
    }

    step(inclusion ? "Re-executing original bundle transaction" : "Replaying handleOps on the fork");
    const args = { fork, op, entryPoint, chainId: req.chainId, labels, roles, replayCtx: context.replay };
    labels[DEV.bundler] ??= "Replay bundler (Anvil dev account)";
    const replay = await time("replay", () => (inclusion ? replayIncluded(args, inclusion) : replayPending(args, BigInt(context.block.timestamp))));
    if (inclusion) {
      context.replay.exactness = replay.comparison?.identical ? "exact" : "approximate";
      if (!replay.comparison?.identical) context.replay.approximations.push("Replayed receipt differs from the original; see the comparison details.");
    } else {
      context.replay.exactness = "pinned";
      context.replay.approximations.push(`Executed as the only transaction of a hypothetical block ${pinBlock + 1n}; on a live network other transactions may land first.`);
    }
    const tokens = await readTokens(fork.client, targets);
    return finish(preflight, replay, tokens, balances);
  } finally {
    await fork?.stop();
    await fixture?.stop();
  }
}

async function tokenBalance(client: Client, token: Address, holder: Address, block: bigint | "latest"): Promise<string | undefined> {
  try {
    const v = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder], ...(block === "latest" ? {} : { blockNumber: block }) });
    return v.toString();
  } catch {
    return undefined;
  }
}

export function fixtureRequest(id: string): InspectRequest {
  const f = FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown fixture ${id}`);
  return {
    userOp: null,
    chainId: 31337,
    entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as Address,
    connection: { kind: "fixture", fixtureId: id },
    block: id === "token-balance" ? { kind: "inclusion", txHash: "0x" as Hex } : { kind: "latest" },
    mode: "preflight+replay",
    label: f.title,
  };
}
