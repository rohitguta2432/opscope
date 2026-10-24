import type { Address, Hex } from "viem";
import type { PackedUserOperationHex, RpcUserOperation } from "./userop";

/** Lifecycle order shown in the UI: RPC checks → wallet validation → sponsor checks → execution. */
export type StageId = "rpc" | "account" | "paymaster" | "execution";
export const STAGES: { id: StageId; label: string; short: string }[] = [
  { id: "rpc", label: "RPC checks", short: "RPC" },
  { id: "account", label: "Wallet validation", short: "Wallet" },
  { id: "paymaster", label: "Sponsor checks", short: "Sponsor" },
  { id: "execution", label: "Execution", short: "Execution" },
];

export type Component =
  | "rpc"
  | "config"
  | "userop"
  | "factory"
  | "account"
  | "paymaster"
  | "entrypoint"
  | "bundler"
  | "target"
  | "unknown";

/** Where a fact came from. Anything not listed here is an inference, and is labelled as one. */
export type EvidenceSource =
  | "input" // static check of the submitted operation
  | "rpc.read" // read-only call against the configured RPC at the pinned block
  | "rpc.simulateValidation" // eth_call with EntryPointSimulations code overridden at the EntryPoint
  | "fork.read" // read against the isolated Anvil fork (exact pre-transaction state)
  | "fork.simulateValidation"
  | "replay.call" // eth_call handleOps on the Anvil fork
  | "replay.tx" // handleOps transaction mined on the Anvil fork
  | "replay.trace" // debug trace on the fork
  | "original.receipt"; // receipt of the original inclusion transaction

export type CheckStatus = "pass" | "fail" | "warn" | "info" | "unavailable" | "skipped";

export interface Check {
  id: string;
  stage: StageId;
  label: string;
  status: CheckStatus;
  source: EvidenceSource;
  /** observed: read from chain/EVM; computed: derived locally from op fields; policy: bundler rule that varies by bundler */
  basis: "observed" | "computed" | "policy";
  detail: string;
  values?: Record<string, string>;
}

export interface DecodedArg {
  name: string;
  type: string;
  value: string;
}

export interface DecodedRevert {
  raw: Hex;
  kind: "FailedOp" | "FailedOpWithRevert" | "PostOpReverted" | "Error" | "Panic" | "custom" | "empty" | "unknown";
  name?: string;
  signature?: string;
  args?: DecodedArg[];
  /** human summary, e.g. FailedOp(0, "AA31 paymaster deposit too low") */
  message: string;
  aaCode?: string;
  aaReason?: string;
  inner?: DecodedRevert;
  /** contract ABI that matched */
  abi?: string;
}

export interface DecodedCall {
  contract?: string;
  fn: string;
  signature: string;
  args: DecodedArg[];
  /** calls wrapped by account execute/executeBatch */
  inner?: { target: Address; value: string; data: Hex; call?: DecodedCall }[];
}

export interface TraceFrame {
  id: string;
  type: string;
  from: Address;
  to?: Address;
  value?: string;
  gas?: string;
  gasUsed?: string;
  input: Hex;
  output?: Hex;
  error?: string;
  depth: number;
  label?: string;
  role?: "entrypoint" | "account" | "paymaster" | "factory" | "senderCreator" | "target" | "precompile" | "other";
  decoded?: DecodedCall;
  revert?: DecodedRevert;
  status: "ok" | "reverted";
  calls: TraceFrame[];
}

export type TraceEvidence =
  | { status: "ok"; method: "debug_traceCall" | "debug_traceTransaction"; root: TraceFrame }
  | { status: "unavailable"; reason: string };

export interface SimValidationOk {
  preOpGas: string;
  prefund: string;
  accountValidationData: string;
  paymasterValidationData: string;
  sigFailed: boolean;
  paymasterSigFailed: boolean;
  validAfter: number;
  validUntil: number;
  paymasterValidAfter: number;
  paymasterValidUntil: number;
  aggregator: Address;
}

export type SimulateValidationEvidence =
  | { status: "ok"; source: "rpc.simulateValidation" | "fork.simulateValidation"; result: SimValidationOk }
  | { status: "reverted"; source: "rpc.simulateValidation" | "fork.simulateValidation"; revert: DecodedRevert }
  | { status: "unavailable"; reason: string };

export interface SignatureAnalysis {
  scheme: string;
  owner?: Address;
  recovered?: Address;
  matchesOwner: boolean;
  /** hash variants tried, and whether the owner signed that variant */
  variants: { label: string; hash: Hex; recovered?: Address; matchesOwner: boolean }[];
  error?: string;
}

export interface PreflightEvidence {
  ran: boolean;
  target: string;
  checks: Check[];
  simulateValidation: SimulateValidationEvidence;
  userOpHash: { local: Hex; entryPoint?: Hex; matches?: boolean };
  signature?: SignatureAnalysis;
  reads: Record<string, string>;
}

export interface UserOpEventEvidence {
  success: boolean;
  actualGasCost: string;
  actualGasUsed: string;
  nonce: string;
  paymaster: Address;
}

export interface ReplayEvidence {
  ran: boolean;
  status: "validation-reverted" | "executed" | "tx-reverted" | "error" | "skipped";
  note?: string;
  handleOpsCall?: { status: "ok" | "reverted"; revert?: DecodedRevert };
  tx?: { hash: Hex; status: "success" | "reverted"; gasUsed: string; blockNumber: string; from: Address; gasLimit: string };
  userOpEvent?: UserOpEventEvidence;
  revertReason?: DecodedRevert;
  postOpRevertReason?: DecodedRevert;
  prefundTooLow?: boolean;
  accountDeployed?: { factory: Address };
  trace: TraceEvidence;
  comparison?: { identical: boolean; details: string[] };
}

export interface StateOverride {
  address: Address;
  kind: "code" | "balance" | "storage" | "impersonation";
  detail: string;
  purpose: string;
  scope: "preflight eth_call" | "replay fork";
}

export interface ExecutionContext {
  chain: { id: number; name: string };
  block: { number: string; hash: Hex; timestamp: string; baseFeePerGas?: string; pinnedBy: "latest" | "number" | "inclusion" };
  entryPoint: { address: Address; version: string; codeHash?: Hex; canonical: boolean; note: string };
  account: { address: Address; deployed: boolean; codeHash?: Hex; implementation?: { address?: Address; codeHash?: Hex; label: string; known: boolean } };
  paymaster?: { address: Address; deployed: boolean; codeHash?: Hex; label?: string };
  connection: { id: string; kind: "fixture" | "rpc"; host: string };
  inclusion?: { txHash: Hex; blockNumber: string; txIndex: number; from: Address; precedingTx?: Hex };
  replay: {
    engine: "anvil";
    anvilVersion?: string;
    mode: "fork-at-block" | "fork-after-transaction" | "not-run";
    forkBlock?: string;
    forkAfterTx?: Hex;
    precedingTxs: number;
    /**
     * exact: included op, original transaction re-executed from its exact pre-state, receipt matched.
     * pinned: pending op executed on the pinned block's state as a hypothetical next block.
     * approximate: a known fidelity gap (listed in approximations).
     */
    exactness: "exact" | "pinned" | "approximate" | "not-run";
    approximations: string[];
    stateOverrides: StateOverride[];
    blockEnv: { field: string; value: string; reason: string }[];
    handleOps?: { from: Address; beneficiary: Address; gasLimit: string; note: string };
  };
  tools: { opscope: string; node: string; anvil?: string };
  fixture?: { id: string; version: number; title: string };
}

export interface ToolError {
  code: string;
  stage: StageId;
  message: string;
  detail?: string;
}

export interface Evidence {
  schemaVersion: 1;
  createdAt: string;
  chainId: number;
  entryPoint: Address;
  userOp: RpcUserOperation;
  packed: PackedUserOperationHex;
  userOpHash: Hex;
  inputWarnings: string[];
  context: ExecutionContext;
  preflight: PreflightEvidence;
  replay: ReplayEvidence;
  errors: ToolError[];
  labels: Record<string, string>;
  /** ERC-20 metadata read on the fork for tokens the operation touches */
  tokens: Record<string, { symbol: string; decimals: number }>;
  /** sender's balance of each called token: right before the operation, and at the start of its block */
  balances: { token: Address; holder: Address; beforeOp: string; atBlockStart?: string }[];
  timings: Record<string, number>;
}

export type BlockSelector =
  | { kind: "latest" }
  | { kind: "number"; number: string; hash?: Hex }
  | { kind: "inclusion"; txHash: Hex };

export type ConnectionRef = { kind: "rpc"; id: string } | { kind: "fixture"; fixtureId: string };

export interface InspectRequest {
  /** raw UserOperation JSON as pasted (any accepted shape) */
  userOp: unknown;
  chainId: number;
  entryPoint: Address;
  connection: ConnectionRef;
  block: BlockSelector;
  mode: "preflight+replay" | "preflight";
  label?: string;
}

export interface FixtureInfo {
  id: string;
  version: number;
  title: string;
  summary: string;
  demo: boolean;
  expectedCode: string;
}

export interface ConnectionInfo {
  id: string;
  chainId: number;
  label: string;
  /** redacted host only; the URL never leaves the server */
  host: string;
}
