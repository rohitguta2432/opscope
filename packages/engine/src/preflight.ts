import {
  decodeFunctionResult,
  encodeFunctionData,
  recoverAddress,
  recoverMessageAddress,
  size,
  type Address,
  type Hex,
} from "viem";
import {
  CHAINS,
  ENTRYPOINT_V06,
  ENTRYPOINT_V08,
  chainName,
  decodeCall,
  decodeRevert,
  eth,
  getUserOpHashV07,
  gwei,
  nonceParts,
  packUserOp,
  parseValidationData,
  requiredPrefund,
  sameAddress,
  type Check,
  type ExecutionContext,
  type PreflightEvidence,
  type SignatureAnalysis,
  type SimulateValidationEvidence,
  type UserOperationV07,
} from "@opscope/core";
import { artifacts } from "./artifacts";
import { isSimpleAccountV07 } from "./context";
import { rawCall, type BlockRef, type Client } from "./rpc";

export interface PreflightArgs {
  client: Client;
  op: UserOperationV07;
  entryPoint: Address;
  chainId: number;
  block: BlockRef;
  blockTimestamp: bigint;
  baseFeePerGas?: bigint;
  /** "rpc" = configured RPC at the pinned block; "fork" = isolated Anvil fork at exact pre-transaction state */
  target: "rpc" | "fork";
  targetLabel: string;
  code: Pick<ExecutionContext, "entryPoint" | "account" | "paymaster">;
  labels: Record<string, string>;
}

const bn = (b: BlockRef) => (b === "latest" ? { blockTag: "latest" as const } : { blockNumber: b });

/**
 * Bundler-style preflight: what a bundler checks before it accepts an operation, using only
 * read-only calls. It runs EntryPointSimulations.simulateValidation through an eth_call state
 * override, the way v0.7 bundlers do. It does NOT apply ERC-7562 opcode/storage rules,
 * reputation or fee policies; the diagnosis says so.
 */
export async function runPreflight(a: PreflightArgs): Promise<PreflightEvidence> {
  const { client, op, entryPoint, chainId, block, code } = a;
  const read = a.target === "rpc" ? ("rpc.read" as const) : ("fork.read" as const);
  const simSource = a.target === "rpc" ? ("rpc.simulateValidation" as const) : ("fork.simulateValidation" as const);
  const checks: Check[] = [];
  const reads: Record<string, string> = {};
  const packed = packUserOp(op);
  const localHash = getUserOpHashV07(op, entryPoint, chainId);
  const epAbi = artifacts.EntryPoint.abi;
  const label = (addr?: string) => (addr ? (a.labels[addr] ?? addr) : "—");

  // ── RPC / EntryPoint ─────────────────────────────────────────────
  checks.push({
    id: "rpc.entryPoint.code",
    stage: "rpc",
    label: "EntryPoint deployed",
    status: code.entryPoint.canonical ? "pass" : code.entryPoint.codeHash ? "warn" : "fail",
    source: read,
    basis: "observed",
    detail: code.entryPoint.note,
    values: { address: entryPoint, codeHash: code.entryPoint.codeHash ?? "none" },
  });

  let epHash: Hex | undefined;
  const h = await rawCall(client, { to: entryPoint, data: encodeFunctionData({ abi: epAbi, functionName: "getUserOpHash", args: [packed] }), block });
  if (h.ok && size(h.data) === 32) {
    epHash = h.data;
    checks.push({
      id: "rpc.userOpHash",
      stage: "rpc",
      label: "userOpHash",
      status: sameAddress(epHash, localHash) ? "pass" : "warn",
      source: read,
      basis: "observed",
      detail: sameAddress(epHash, localHash) ? "EntryPoint.getUserOpHash matches the locally computed v0.7 hash." : "EntryPoint returned a different hash than the v0.7 formula — not a v0.7 EntryPoint?",
      values: { entryPoint: epHash, local: localHash },
    });
  } else {
    checks.push({ id: "rpc.userOpHash", stage: "rpc", label: "userOpHash", status: "unavailable", source: read, basis: "observed", detail: `getUserOpHash call failed: ${h.ok ? "unexpected return size" : h.message}` });
  }

  // ── Account ──────────────────────────────────────────────────────
  if (op.factory && code.account.deployed) {
    checks.push({ id: "account.deployment", stage: "account", label: "Account deployment", status: "fail", source: read, basis: "observed", detail: "initCode is set but the sender already has code — EntryPoint reverts with AA10.", values: { sender: op.sender, factory: op.factory } });
  } else if (!op.factory && !code.account.deployed) {
    checks.push({ id: "account.deployment", stage: "account", label: "Account deployment", status: "fail", source: read, basis: "observed", detail: "Sender has no code and no factory is set — EntryPoint reverts with AA20.", values: { sender: op.sender } });
  } else {
    checks.push({
      id: "account.deployment",
      stage: "account",
      label: "Account deployment",
      status: "pass",
      source: read,
      basis: "observed",
      detail: code.account.deployed ? `Sender is deployed (${code.account.implementation?.label ?? "unknown implementation"}).` : `Sender will be deployed by factory ${label(op.factory)}.`,
      values: { sender: op.sender, ...(code.account.codeHash ? { codeHash: code.account.codeHash } : {}) },
    });
  }

  const { key, sequence } = nonceParts(op.nonce);
  const n = await rawCall(client, { to: entryPoint, data: encodeFunctionData({ abi: epAbi, functionName: "getNonce", args: [op.sender, key] }), block });
  if (n.ok) {
    const expected = BigInt(n.data);
    const exp = nonceParts(expected);
    reads.expectedNonce = expected.toString();
    checks.push({
      id: "account.nonce",
      stage: "account",
      label: "Nonce",
      status: expected === op.nonce ? "pass" : "fail",
      source: read,
      basis: "observed",
      detail:
        expected === op.nonce
          ? `Sequence ${sequence} on key ${key} is next.`
          : sequence < exp.sequence
            ? `Sequence ${sequence} was already used; EntryPoint expects ${exp.sequence} on key ${key}.`
            : `Sequence ${sequence} is ahead; EntryPoint expects ${exp.sequence} on key ${key}.`,
      values: { provided: op.nonce.toString(), expected: expected.toString(), key: key.toString() },
    });
  } else {
    checks.push({ id: "account.nonce", stage: "account", label: "Nonce", status: "unavailable", source: read, basis: "observed", detail: `getNonce failed: ${n.message}` });
  }

  const prefund = requiredPrefund(op);
  reads.requiredPrefund = prefund.toString();
  const balanceOf = async (who: Address) => {
    const r = await rawCall(client, { to: entryPoint, data: encodeFunctionData({ abi: epAbi, functionName: "balanceOf", args: [who] }), block });
    return r.ok ? BigInt(r.data) : undefined;
  };

  if (!op.paymaster) {
    const deposit = await balanceOf(op.sender);
    const balance = await client.getBalance({ address: op.sender, ...bn(block) });
    reads.accountDeposit = deposit?.toString() ?? "unavailable";
    reads.accountBalance = balance.toString();
    if (deposit === undefined) {
      checks.push({ id: "account.prefund", stage: "account", label: "Prefund", status: "unavailable", source: read, basis: "observed", detail: "Could not read the account's EntryPoint deposit." });
    } else {
      const missing = prefund > deposit ? prefund - deposit : 0n;
      const ok = missing <= balance;
      checks.push({
        id: "account.prefund",
        stage: "account",
        label: "Prefund",
        status: ok ? "pass" : "fail",
        source: read,
        basis: "computed",
        detail: ok
          ? `Required ${eth(prefund)}; deposit ${eth(deposit)}${missing ? `, the account pays the missing ${eth(missing)} from its balance` : ""}.`
          : `Required ${eth(prefund)} but deposit ${eth(deposit)} + balance ${eth(balance)} is short by ${eth(missing - balance)}.`,
        values: { requiredPrefund: prefund.toString(), deposit: deposit.toString(), balance: balance.toString(), shortfall: (ok ? 0n : missing - balance).toString() },
      });
    }
  }

  let signature: SignatureAnalysis | undefined;
  if (code.account.deployed && isSimpleAccountV07(code)) {
    signature = await analyzeSignature(client, op, entryPoint, chainId, block, localHash);
    checks.push({
      id: "account.signature",
      stage: "account",
      label: "Owner signature",
      status: signature.error ? "fail" : signature.matchesOwner ? "pass" : "fail",
      source: read,
      basis: "observed",
      detail: signature.error
        ? signature.error
        : signature.matchesOwner
          ? "Signature recovers to the account owner over the v0.7 userOpHash."
          : `Signature recovers to ${signature.recovered}, not the owner ${signature.owner}.`,
      values: { owner: signature.owner ?? "unknown", recovered: signature.recovered ?? "—" },
    });
  } else if (code.account.deployed) {
    checks.push({ id: "account.signature", stage: "account", label: "Owner signature", status: "skipped", source: read, basis: "observed", detail: "Account implementation not recognised; signature scheme unknown, so only EntryPoint's verdict is used." });
  }

  // ── Paymaster ────────────────────────────────────────────────────
  if (op.paymaster) {
    checks.push({
      id: "paymaster.code",
      stage: "paymaster",
      label: "Paymaster deployed",
      status: code.paymaster?.deployed ? "pass" : "fail",
      source: read,
      basis: "observed",
      detail: code.paymaster?.deployed ? `${label(op.paymaster)} has code.` : "No code at the paymaster address — EntryPoint reverts with AA30.",
      values: { paymaster: op.paymaster },
    });
    const deposit = await balanceOf(op.paymaster);
    reads.paymasterDeposit = deposit?.toString() ?? "unavailable";
    if (deposit === undefined) {
      checks.push({ id: "paymaster.deposit", stage: "paymaster", label: "Paymaster deposit", status: "unavailable", source: read, basis: "observed", detail: "Could not read the paymaster's EntryPoint deposit." });
    } else {
      const ok = deposit >= prefund;
      checks.push({
        id: "paymaster.deposit",
        stage: "paymaster",
        label: "Paymaster deposit",
        status: ok ? "pass" : "fail",
        source: read,
        basis: "computed",
        detail: ok ? `Deposit ${eth(deposit)} covers the ${eth(prefund)} prefund.` : `Deposit ${eth(deposit)} is below the ${eth(prefund)} prefund (short ${eth(prefund - deposit)}).`,
        values: { requiredPrefund: prefund.toString(), deposit: deposit.toString(), shortfall: (ok ? 0n : prefund - deposit).toString() },
      });
    }
  }

  // ── simulateValidation (EntryPointSimulations via state override) ──
  const simulateValidation = await simulate(a, packed, simSource);
  if (simulateValidation.status === "ok") {
    const r = simulateValidation.result;
    const ts = Number(a.blockTimestamp);
    const nextTs = ts + 12;
    checks.push({
      id: "account.simulateValidation",
      stage: "account",
      label: "simulateValidation (account)",
      status: r.sigFailed ? "fail" : "pass",
      source: simSource,
      basis: "observed",
      detail: r.sigFailed ? "validateUserOp returned SIG_VALIDATION_FAILED; handleOps will revert with AA24." : "Account validation returned success.",
      values: { accountValidationData: r.accountValidationData, preOpGas: r.preOpGas },
    });
    const outOfRange = nextTs > r.validUntil || nextTs < r.validAfter;
    if (r.validAfter > 0 || r.validUntil < 2 ** 48 - 1) {
      checks.push({
        id: "account.validationWindow",
        stage: "account",
        label: "Signature time window",
        status: outOfRange ? "fail" : "pass",
        source: simSource,
        basis: "observed",
        detail: `validAfter ${r.validAfter}, validUntil ${r.validUntil}; next block ≈ ${nextTs}.`,
      });
    }
    if (op.paymaster) {
      checks.push({
        id: "paymaster.simulateValidation",
        stage: "paymaster",
        label: "simulateValidation (paymaster)",
        status: r.paymasterSigFailed ? "fail" : "pass",
        source: simSource,
        basis: "observed",
        detail: r.paymasterSigFailed ? "Paymaster returned a signature failure (AA34)." : "validatePaymasterUserOp accepted the operation.",
        values: { paymasterValidationData: r.paymasterValidationData },
      });
    }
  } else if (simulateValidation.status === "reverted") {
    const stage = simulateValidation.revert.aaCode?.startsWith("AA3") ? "paymaster" : "account";
    checks.push({
      id: `${stage}.simulateValidation`,
      stage,
      label: `simulateValidation (${stage === "paymaster" ? "paymaster" : "account"})`,
      status: "fail",
      source: simSource,
      basis: "observed",
      detail: `Reverted: ${simulateValidation.revert.message}`,
    });
  } else {
    checks.push({ id: "account.simulateValidation", stage: "account", label: "simulateValidation", status: "unavailable", source: simSource, basis: "observed", detail: simulateValidation.reason });
  }

  // ── Execution (preflight can only describe it) ───────────────────
  const call = decodeCall(op.callData);
  checks.push({
    id: "execution.callData",
    stage: "execution",
    label: "Call data",
    status: "info",
    source: "input",
    basis: "computed",
    detail: call
      ? `${call.contract}.${call.fn}${call.inner?.length ? ` → ${call.inner.map((i) => `${label(i.target)}${i.call ? `.${i.call.fn}` : ""}`).join(", ")}` : ""}`
      : op.callData === "0x"
        ? "Empty callData (validation only)."
        : "Unrecognised callData selector.",
  });

  // ── Bundler policy (varies by bundler, not enforced by EntryPoint) ──
  if (a.baseFeePerGas !== undefined) {
    checks.push({
      id: "rpc.feePolicy",
      stage: "rpc",
      label: "Fee vs base fee",
      status: op.maxFeePerGas >= a.baseFeePerGas ? "pass" : "warn",
      source: read,
      basis: "policy",
      detail: `maxFeePerGas ${gwei(op.maxFeePerGas)} vs block base fee ${gwei(a.baseFeePerGas)}. Bundlers apply their own minimums.`,
    });
  }

  return {
    ran: true,
    target: a.targetLabel,
    checks,
    simulateValidation,
    userOpHash: { local: localHash, entryPoint: epHash, matches: epHash ? sameAddress(epHash, localHash) : undefined },
    signature,
    reads,
  };
}

async function simulate(a: PreflightArgs, packed: ReturnType<typeof packUserOp>, source: "rpc.simulateValidation" | "fork.simulateValidation"): Promise<SimulateValidationEvidence> {
  const simAbi = artifacts.EntryPointSimulations.abi;
  const r = await rawCall(a.client, {
    to: a.entryPoint,
    data: encodeFunctionData({ abi: simAbi, functionName: "simulateValidation", args: [packed] }),
    block: a.block,
    gas: 10_000_000n,
    stateOverride: { [a.entryPoint]: { code: artifacts.EntryPointSimulations.deployedBytecode } },
  });
  if (r.ok) {
    try {
      const res = decodeFunctionResult({ abi: simAbi, functionName: "simulateValidation", data: r.data }) as {
        returnInfo: { preOpGas: bigint; prefund: bigint; accountValidationData: bigint; paymasterValidationData: bigint };
        aggregatorInfo: { aggregator: Address };
      };
      const acc = parseValidationData(res.returnInfo.accountValidationData);
      const pm = parseValidationData(res.returnInfo.paymasterValidationData);
      return {
        status: "ok",
        source,
        result: {
          preOpGas: res.returnInfo.preOpGas.toString(),
          prefund: res.returnInfo.prefund.toString(),
          accountValidationData: `0x${res.returnInfo.accountValidationData.toString(16)}`,
          paymasterValidationData: `0x${res.returnInfo.paymasterValidationData.toString(16)}`,
          sigFailed: acc.sigFailed,
          paymasterSigFailed: BigInt(pm.aggregator) !== 0n,
          validAfter: acc.validAfter,
          validUntil: acc.validUntil,
          paymasterValidAfter: pm.validAfter,
          paymasterValidUntil: pm.validUntil,
          aggregator: acc.aggregator,
        },
      };
    } catch (e) {
      return { status: "unavailable", reason: `Could not decode simulateValidation result: ${(e as Error).message.split("\n")[0]}` };
    }
  }
  if (r.data && r.data !== "0x") return { status: "reverted", source, revert: decodeRevert(r.data) };
  return { status: "unavailable", reason: `eth_call with state override failed (${r.message}). The node may not support state overrides.` };
}

async function analyzeSignature(client: Client, op: UserOperationV07, entryPoint: Address, chainId: number, block: BlockRef, hash: Hex): Promise<SignatureAnalysis> {
  const out: SignatureAnalysis = { scheme: "SimpleAccount v0.7: ECDSA over EIP-191(userOpHash)", matchesOwner: false, variants: [] };
  try {
    out.owner = (await client.readContract({ address: op.sender, abi: artifacts.SimpleAccount.abi, functionName: "owner", ...bn(block) })) as Address;
  } catch {
    out.error = "Could not read owner() from the account.";
    return out;
  }
  if (size(op.signature) !== 65) {
    out.error = `Signature is ${size(op.signature)} bytes; SimpleAccount expects a 65-byte ECDSA signature (ECDSA.recover reverts → AA23).`;
    return out;
  }
  const tryRecover = async (label: string, h: Hex, prefixed: boolean) => {
    try {
      const recovered = prefixed ? await recoverMessageAddress({ message: { raw: h }, signature: op.signature }) : await recoverAddress({ hash: h, signature: op.signature });
      const v = { label, hash: h, recovered, matchesOwner: sameAddress(recovered, out.owner) };
      out.variants.push(v);
      return v;
    } catch {
      out.variants.push({ label, hash: h, matchesOwner: false });
      return undefined;
    }
  };
  const main = await tryRecover(`EIP-191 · EntryPoint v0.7 · chain ${chainId}`, hash, true);
  out.recovered = main?.recovered;
  out.matchesOwner = !!main?.matchesOwner;
  if (out.matchesOwner) return out;

  // Common signer bugs: wrong chain id, wrong EntryPoint address, missing EIP-191 prefix.
  await tryRecover(`raw hash (no EIP-191 prefix) · chain ${chainId}`, hash, false);
  for (const c of CHAINS) {
    if (c.id === chainId) continue;
    const v = await tryRecover(`EIP-191 · EntryPoint v0.7 · chain ${c.id} (${chainName(c.id)})`, getUserOpHashV07(op, entryPoint, c.id), true);
    if (v?.matchesOwner) break;
  }
  for (const [name, ep] of [["v0.6", ENTRYPOINT_V06], ["v0.8", ENTRYPOINT_V08]] as const) {
    await tryRecover(`EIP-191 · v0.7 hash with ${name} EntryPoint address`, getUserOpHashV07(op, ep, chainId), true);
  }
  return out;
}
