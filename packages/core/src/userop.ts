import {
  concat,
  encodeAbiParameters,
  getAddress,
  hexToBigInt,
  keccak256,
  pad,
  size,
  slice,
  toHex,
  type Address,
  type Hex,
} from "viem";

/** ERC-4337 v0.7 UserOperation in its unpacked (RPC) form, numbers as bigint. */
export interface UserOperationV07 {
  sender: Address;
  nonce: bigint;
  factory?: Address;
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster?: Address;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
  paymasterData?: Hex;
  signature: Hex;
}

/** On-chain PackedUserOperation (EntryPoint v0.7 calldata struct). */
export interface PackedUserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

/** JSON-safe RPC shape (every quantity hex-encoded), what bundlers accept and OpScope exports. */
export type RpcUserOperation = {
  [K in keyof UserOperationV07]: UserOperationV07[K] extends bigint | undefined ? Hex : UserOperationV07[K];
};

export type PackedUserOperationHex = Omit<PackedUserOperation, "nonce" | "preVerificationGas"> & {
  nonce: Hex;
  preVerificationGas: Hex;
};

const u128 = (v: bigint) => pad(toHex(v), { size: 16 });

export function packUserOp(op: UserOperationV07): PackedUserOperation {
  const initCode = op.factory ? concat([op.factory, op.factoryData ?? "0x"]) : "0x";
  const paymasterAndData = op.paymaster
    ? concat([
        op.paymaster,
        u128(op.paymasterVerificationGasLimit ?? 0n),
        u128(op.paymasterPostOpGasLimit ?? 0n),
        op.paymasterData ?? "0x",
      ])
    : "0x";
  return {
    sender: op.sender,
    nonce: op.nonce,
    initCode,
    callData: op.callData,
    accountGasLimits: concat([u128(op.verificationGasLimit), u128(op.callGasLimit)]),
    preVerificationGas: op.preVerificationGas,
    gasFees: concat([u128(op.maxPriorityFeePerGas), u128(op.maxFeePerGas)]),
    paymasterAndData,
    signature: op.signature,
  };
}

export function unpackUserOp(p: PackedUserOperation): UserOperationV07 {
  const initLen = size(p.initCode);
  const pmLen = size(p.paymasterAndData);
  const op: UserOperationV07 = {
    sender: getAddress(p.sender),
    nonce: p.nonce,
    callData: p.callData,
    verificationGasLimit: hexToBigInt(slice(p.accountGasLimits, 0, 16)),
    callGasLimit: hexToBigInt(slice(p.accountGasLimits, 16, 32)),
    preVerificationGas: p.preVerificationGas,
    maxPriorityFeePerGas: hexToBigInt(slice(p.gasFees, 0, 16)),
    maxFeePerGas: hexToBigInt(slice(p.gasFees, 16, 32)),
    signature: p.signature,
  };
  if (initLen >= 20) {
    op.factory = getAddress(slice(p.initCode, 0, 20));
    op.factoryData = initLen > 20 ? slice(p.initCode, 20) : "0x";
  }
  if (pmLen >= 52) {
    op.paymaster = getAddress(slice(p.paymasterAndData, 0, 20));
    op.paymasterVerificationGasLimit = hexToBigInt(slice(p.paymasterAndData, 20, 36));
    op.paymasterPostOpGasLimit = hexToBigInt(slice(p.paymasterAndData, 36, 52));
    op.paymasterData = pmLen > 52 ? slice(p.paymasterAndData, 52) : "0x";
  }
  return op;
}

/** keccak of the packed op fields, exactly UserOperationLib.hash in v0.7. */
export function hashPackedUserOp(p: PackedUserOperation): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        p.sender,
        p.nonce,
        keccak256(p.initCode),
        keccak256(p.callData),
        p.accountGasLimits,
        p.preVerificationGas,
        p.gasFees,
        keccak256(p.paymasterAndData),
      ],
    ),
  );
}

/** EntryPoint v0.7 getUserOpHash: keccak256(abi.encode(op.hash(), entryPoint, chainId)). */
export function getUserOpHashV07(op: UserOperationV07, entryPoint: Address, chainId: number | bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [hashPackedUserOp(packUserOp(op)), entryPoint, BigInt(chainId)],
    ),
  );
}

/** EntryPoint._getRequiredPrefund: total gas limits × maxFeePerGas. */
export function requiredPrefund(op: UserOperationV07): bigint {
  return requiredGas(op) * op.maxFeePerGas;
}

export function requiredGas(op: UserOperationV07): bigint {
  return (
    op.verificationGasLimit +
    op.callGasLimit +
    (op.paymasterVerificationGasLimit ?? 0n) +
    (op.paymasterPostOpGasLimit ?? 0n) +
    op.preVerificationGas
  );
}

/** v0.7 nonces are key (192 bits) || sequence (64 bits). */
export function nonceParts(nonce: bigint): { key: bigint; sequence: bigint } {
  return { key: nonce >> 64n, sequence: nonce & ((1n << 64n) - 1n) };
}

export interface ValidationData {
  aggregator: Address;
  sigFailed: boolean;
  validAfter: number;
  validUntil: number;
  /** validUntil 0 means "no expiry" on-chain. */
  hasExpiry: boolean;
}

/** Helpers._parseValidationData. */
export function parseValidationData(v: bigint): ValidationData {
  const aggregator = getAddress(pad(toHex(v & ((1n << 160n) - 1n)), { size: 20 }));
  const rawUntil = Number((v >> 160n) & ((1n << 48n) - 1n));
  const validAfter = Number((v >> 208n) & ((1n << 48n) - 1n));
  return {
    aggregator,
    sigFailed: BigInt(aggregator) === 1n,
    validAfter,
    validUntil: rawUntil === 0 ? 2 ** 48 - 1 : rawUntil,
    hasExpiry: rawUntil !== 0,
  };
}

export function toRpcUserOp(op: UserOperationV07): RpcUserOperation {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(op)) {
    if (v === undefined) continue;
    out[k] = typeof v === "bigint" ? toHex(v) : v;
  }
  return out as RpcUserOperation;
}

export function fromRpcUserOp(r: RpcUserOperation): UserOperationV07 {
  const out: Record<string, unknown> = {};
  const big = new Set([
    "nonce",
    "callGasLimit",
    "verificationGasLimit",
    "preVerificationGas",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "paymasterVerificationGasLimit",
    "paymasterPostOpGasLimit",
  ]);
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined || v === null) continue;
    out[k] = big.has(k) ? BigInt(v as string) : v;
  }
  return out as unknown as UserOperationV07;
}

export function packedToHex(p: PackedUserOperation): PackedUserOperationHex {
  return { ...p, nonce: toHex(p.nonce), preVerificationGas: toHex(p.preVerificationGas) };
}
