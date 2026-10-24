import { z } from "zod";
import { getAddress, isAddress, size, type Address, type Hex } from "viem";
import { unpackUserOp, type UserOperationV07 } from "./userop";

const MAX_U120 = (1n << 120n) - 1n;
const MAX_U256 = (1n << 256n) - 1n;

const address = z
  .string({ error: (iss) => (iss.input === undefined ? "required" : "expected a 0x address string") })
  .refine((v) => isAddress(v, { strict: false }), { error: "expected a 20-byte 0x address" })
  .transform((v) => getAddress(v));

const bytes = z
  .string({ error: (iss) => (iss.input === undefined ? "required" : "expected a 0x hex string") })
  .regex(/^0x([0-9a-fA-F]{2})*$/, { error: "expected 0x-prefixed hex bytes (even length)" })
  .transform((v) => v.toLowerCase() as Hex);

const bytes32 = bytes.refine((v) => size(v) === 32, { error: "expected 32 bytes" });

function toBig(v: string | number | bigint): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("number is not a safe integer; pass it as a hex string");
    return BigInt(v);
  }
  const s = v.trim();
  if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
  if (/^[0-9]+$/.test(s)) return BigInt(s);
  throw new Error("expected a hex (0x…) or decimal quantity");
}

const quantity = (max: bigint, label: string) =>
  z.union([z.string(), z.number(), z.bigint()], { error: (iss) => (iss.input === undefined ? "required" : "expected a hex (0x…) or decimal quantity") }).transform((v, ctx) => {
    try {
      const b = toBig(v);
      if (b < 0n || b > max) {
        ctx.addIssue({ code: "custom", message: `${label} is out of range` });
        return z.NEVER;
      }
      return b;
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  });

const gas = quantity(MAX_U120, "gas value (EntryPoint requires ≤ uint120, else AA94)");
const u256 = quantity(MAX_U256, "value");
const optAddress = address.nullish();
const optBytes = bytes.nullish();

export const unpackedUserOpSchema = z.object({
  sender: address,
  nonce: u256,
  factory: optAddress,
  factoryData: optBytes,
  callData: bytes,
  callGasLimit: gas,
  verificationGasLimit: gas,
  preVerificationGas: gas,
  maxFeePerGas: gas,
  maxPriorityFeePerGas: gas,
  paymaster: optAddress,
  paymasterVerificationGasLimit: gas.nullish(),
  paymasterPostOpGasLimit: gas.nullish(),
  paymasterData: optBytes,
  signature: bytes,
});

export const packedUserOpSchema = z.object({
  sender: address,
  nonce: u256,
  initCode: bytes,
  callData: bytes,
  accountGasLimits: bytes32,
  preVerificationGas: gas,
  gasFees: bytes32,
  paymasterAndData: bytes,
  signature: bytes,
});

export interface InputIssue {
  path: string;
  message: string;
}

export type ParsedUserOpInput =
  | {
      ok: true;
      op: UserOperationV07;
      format: "unpacked" | "packed";
      entryPoint?: Address;
      chainId?: number;
      warnings: string[];
    }
  | { ok: false; issues: InputIssue[] };

const UNPACKED_KEYS = new Set(Object.keys(unpackedUserOpSchema.shape));
const PACKED_KEYS = new Set(Object.keys(packedUserOpSchema.shape));

const issuePath = (prefix: string, p: PropertyKey[]) =>
  [prefix, ...p.map(String)].filter(Boolean).join(".") || "(root)";

/**
 * Accepts the shapes people actually paste: a bare v0.7 op (unpacked RPC or packed),
 * { userOperation, entryPoint, chainId }, eth_sendUserOperation params, or a full JSON-RPC body.
 */
export function parseUserOpInput(input: unknown): ParsedUserOpInput {
  let candidate: unknown = input;
  let prefix = "";
  let entryPoint: unknown;
  let chainId: unknown;

  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch (e) {
      return { ok: false, issues: [{ path: "(root)", message: `Invalid JSON: ${(e as Error).message}` }] };
    }
  }
  if (isRecord(candidate) && Array.isArray(candidate.params)) {
    candidate = candidate.params;
    prefix = "params";
  }
  if (Array.isArray(candidate)) {
    entryPoint = candidate[1];
    candidate = candidate[0];
    prefix = prefix ? `${prefix}.0` : "0";
  }
  if (isRecord(candidate)) {
    const inner = candidate.userOperation ?? candidate.userOp;
    if (isRecord(inner)) {
      entryPoint = candidate.entryPoint ?? entryPoint;
      chainId = candidate.chainId ?? chainId;
      prefix = candidate.userOperation ? "userOperation" : "userOp";
      candidate = inner;
    }
  }
  if (!isRecord(candidate)) {
    return { ok: false, issues: [{ path: "(root)", message: "Expected a UserOperation object" }] };
  }

  const warnings: string[] = [];
  const keys = Object.keys(candidate);
  const looksPacked = "accountGasLimits" in candidate || "gasFees" in candidate || "initCode" in candidate;
  const known = looksPacked ? PACKED_KEYS : UNPACKED_KEYS;
  const extra = keys.filter((k) => !known.has(k));
  if (extra.length) warnings.push(`Ignored fields not in the v0.7 ${looksPacked ? "packed" : "RPC"} format: ${extra.join(", ")}`);
  if ("eip7702Auth" in candidate) warnings.push("eip7702Auth is an EntryPoint v0.8 field; v0.7 ignores it.");

  let op: UserOperationV07;
  if (looksPacked) {
    const r = packedUserOpSchema.safeParse(candidate);
    if (!r.success) return { ok: false, issues: r.error.issues.map((i) => ({ path: issuePath(prefix, i.path), message: i.message })) };
    const p = r.data;
    if (p.initCode !== "0x" && size(p.initCode) < 20) return fail(prefix, "initCode", "initCode must be empty or start with a 20-byte factory address");
    if (p.paymasterAndData !== "0x" && size(p.paymasterAndData) < 52)
      return fail(prefix, "paymasterAndData", "paymasterAndData must be empty or ≥ 52 bytes (AA93 invalid paymasterAndData)");
    op = unpackUserOp(p);
  } else {
    const r = unpackedUserOpSchema.safeParse(candidate);
    if (!r.success) return { ok: false, issues: r.error.issues.map((i) => ({ path: issuePath(prefix, i.path), message: i.message })) };
    const u = r.data;
    if (u.factoryData && u.factoryData !== "0x" && !u.factory) return fail(prefix, "factory", "factoryData is set but factory is missing");
    if (u.paymaster && (u.paymasterVerificationGasLimit == null || u.paymasterPostOpGasLimit == null))
      return fail(prefix, "paymasterVerificationGasLimit", "paymaster is set: paymasterVerificationGasLimit and paymasterPostOpGasLimit are required in v0.7");
    op = {
      sender: u.sender,
      nonce: u.nonce,
      callData: u.callData,
      callGasLimit: u.callGasLimit,
      verificationGasLimit: u.verificationGasLimit,
      preVerificationGas: u.preVerificationGas,
      maxFeePerGas: u.maxFeePerGas,
      maxPriorityFeePerGas: u.maxPriorityFeePerGas,
      signature: u.signature,
    };
    if (u.factory) {
      op.factory = u.factory;
      op.factoryData = u.factoryData ?? "0x";
    }
    if (u.paymaster) {
      op.paymaster = u.paymaster;
      op.paymasterVerificationGasLimit = u.paymasterVerificationGasLimit ?? 0n;
      op.paymasterPostOpGasLimit = u.paymasterPostOpGasLimit ?? 0n;
      op.paymasterData = u.paymasterData ?? "0x";
    }
  }
  if (op.maxPriorityFeePerGas > op.maxFeePerGas) warnings.push("maxPriorityFeePerGas is above maxFeePerGas; most bundlers reject this.");

  const out: ParsedUserOpInput = { ok: true, op, format: looksPacked ? "packed" : "unpacked", warnings };
  if (entryPoint !== undefined) {
    const r = address.safeParse(entryPoint);
    if (r.success) out.entryPoint = r.data;
    else warnings.push("entryPoint in the input is not a valid address; ignored.");
  }
  if (chainId !== undefined) {
    try {
      out.chainId = Number(toBig(chainId as string | number));
    } catch {
      warnings.push("chainId in the input is not a number; ignored.");
    }
  }
  return out;
}

function fail(prefix: string, field: string, message: string): ParsedUserOpInput {
  return { ok: false, issues: [{ path: issuePath(prefix, [field]), message }] };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const hexSchema = bytes;
export const addressSchema = address;
