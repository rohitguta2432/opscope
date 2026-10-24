import {
  decodeAbiParameters,
  decodeErrorResult,
  decodeFunctionData,
  size,
  slice,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem";
import entryPointAbi from "./abis/EntryPoint.json" with { type: "json" };
import entryPointSimulationsAbi from "./abis/EntryPointSimulations.json" with { type: "json" };
import senderCreatorAbi from "./abis/SenderCreator.json" with { type: "json" };
import simpleAccountAbi from "./abis/SimpleAccount.json" with { type: "json" };
import simpleAccountFactoryAbi from "./abis/SimpleAccountFactory.json" with { type: "json" };
import sponsorPaymasterAbi from "./abis/SponsorPaymaster.json" with { type: "json" };
import demoTokenAbi from "./abis/DemoToken.json" with { type: "json" };
import type { DecodedArg, DecodedCall, DecodedRevert } from "./types";

export const abis = {
  EntryPoint: entryPointAbi as Abi,
  EntryPointSimulations: entryPointSimulationsAbi as Abi,
  SenderCreator: senderCreatorAbi as Abi,
  SimpleAccount: simpleAccountAbi as Abi,
  SimpleAccountFactory: simpleAccountFactoryAbi as Abi,
  SponsorPaymaster: sponsorPaymasterAbi as Abi,
  DemoToken: demoTokenAbi as Abi,
};

type AbiError = Extract<Abi[number], { type: "error" }>;
type Entry<T> = { contract: string; item: T };

/** Canonical type string, expanding tuples, e.g. (address,uint256)[] */
function canonicalType(p: AbiParameter): string {
  if (p.type.startsWith("tuple")) {
    const comps = (p as { components?: readonly AbiParameter[] }).components ?? [];
    return `(${comps.map(canonicalType).join(",")})${p.type.slice(5)}`;
  }
  return p.type;
}
const canonicalSig = (item: AbiFunction | AbiError) => `${item.name}(${item.inputs.map(canonicalType).join(",")})`;
const displaySig = (item: AbiFunction | AbiError) =>
  `${item.name}(${item.inputs.map((p) => (p.name ? `${canonicalType(p)} ${p.name}` : canonicalType(p))).join(", ")})`;
const fnBySelector = new Map<string, Entry<AbiFunction>[]>();
const errBySelector = new Map<string, Entry<AbiError>[]>();

/** Adds an ABI to the decoder registry. Later registrations are tried after earlier ones. */
export function registerAbi(contract: string, abi: Abi) {
  for (const item of abi) {
    if (item.type === "function") push(fnBySelector, toFunctionSelector(canonicalSig(item)), { contract, item });
    if (item.type === "error") push(errBySelector, toFunctionSelector(canonicalSig(item)), { contract, item });
  }
}
function push<T>(m: Map<string, Entry<T>[]>, k: string, v: Entry<T>) {
  const list = m.get(k) ?? [];
  if (!list.some((e) => e.contract === v.contract)) list.push(v);
  m.set(k, list);
}
for (const [name, abi] of Object.entries(abis)) registerAbi(name, abi);

const ERROR_STRING = "0x08c379a0";
const PANIC = "0x4e487b71";

const PANIC_CODES: Record<number, string> = {
  0x01: "assert(false)",
  0x11: "arithmetic overflow/underflow",
  0x12: "division by zero",
  0x21: "invalid enum value",
  0x22: "invalid storage byte array",
  0x31: "pop on empty array",
  0x32: "array index out of bounds",
  0x41: "out of memory",
  0x51: "call to zero-initialised function",
};

export function formatValue(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v;
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return `[${v.map(formatValue).join(", ")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${k}: ${formatValue(x)}`).join(", ")}}`;
  return String(v);
}

function toArgs(params: readonly AbiParameter[], values: readonly unknown[] | undefined): DecodedArg[] {
  return params.map((p, i) => ({ name: p.name || `arg${i}`, type: p.type, value: formatValue(values?.[i]) }));
}

export function selectorOf(data: Hex): Hex | undefined {
  return size(data) >= 4 ? (slice(data, 0, 4) as Hex) : undefined;
}

export function decodeRevert(data: Hex | undefined | null): DecodedRevert {
  const raw = (data ?? "0x") as Hex;
  if (raw === "0x" || size(raw) === 0) return { raw: "0x", kind: "empty", message: "Reverted without revert data" };
  const sel = selectorOf(raw);
  if (!sel) return { raw, kind: "unknown", message: `Revert data too short to decode (${size(raw)} bytes)` };

  if (sel === ERROR_STRING) {
    try {
      const [reason] = decodeAbiParameters([{ type: "string" }], slice(raw, 4));
      const aaCode = /^AA\d{2}/.exec(reason)?.[0];
      return { raw, kind: "Error", name: "Error", signature: "Error(string)", args: [{ name: "reason", type: "string", value: reason }], message: reason, aaCode, aaReason: aaCode ? reason : undefined };
    } catch {
      /* fall through */
    }
  }
  if (sel === PANIC) {
    try {
      const [code] = decodeAbiParameters([{ type: "uint256" }], slice(raw, 4));
      const n = Number(code);
      return { raw, kind: "Panic", name: "Panic", signature: "Panic(uint256)", args: [{ name: "code", type: "uint256", value: `0x${n.toString(16)}` }], message: `Panic 0x${n.toString(16)}: ${PANIC_CODES[n] ?? "unknown panic code"}` };
    } catch {
      /* fall through */
    }
  }

  for (const { contract, item } of errBySelector.get(sel) ?? []) {
    try {
      const r = decodeErrorResult({ abi: [item], data: raw });
      const values = (r.args ?? []) as readonly unknown[];
      const args = toArgs(item.inputs, values);
      const signature = displaySig(item);
      if (item.name === "FailedOp" || item.name === "FailedOpWithRevert") {
        const reason = String(values[1]);
        const aaCode = /^AA\d{2}/.exec(reason)?.[0];
        const out: DecodedRevert = { raw, kind: item.name, name: item.name, signature, args, message: `${item.name}(${values[0]}, "${reason}")`, aaCode, aaReason: reason, abi: contract };
        if (item.name === "FailedOpWithRevert") {
          out.inner = decodeRevert(values[2] as Hex);
          out.message = `${item.name}(${values[0]}, "${reason}", ${out.inner.name ?? out.inner.kind})`;
        }
        return out;
      }
      if (item.name === "PostOpReverted") {
        const inner = decodeRevert(values[0] as Hex);
        return { raw, kind: "PostOpReverted", name: item.name, signature, args, message: `PostOpReverted(${inner.message})`, inner, abi: contract };
      }
      return { raw, kind: "custom", name: item.name, signature, args, message: `${item.name}(${args.map((a) => a.value).join(", ")})`, abi: contract };
    } catch {
      /* try next candidate */
    }
  }
  return { raw, kind: "unknown", message: `Unknown custom error ${sel}` };
}

/** Decodes calldata against the registry; unwraps SimpleAccount execute/executeBatch one level. */
export function decodeCall(data: Hex | undefined | null): DecodedCall | undefined {
  if (!data) return undefined;
  const sel = selectorOf(data);
  if (!sel) return undefined;
  for (const { contract, item } of fnBySelector.get(sel) ?? []) {
    try {
      const r = decodeFunctionData({ abi: [item], data });
      const values = (r.args ?? []) as readonly unknown[];
      const call: DecodedCall = {
        contract,
        fn: item.name,
        signature: displaySig(item),
        args: toArgs(item.inputs, values),
      };
      if (item.name === "execute" && item.inputs.length === 3) {
        call.inner = [{ target: values[0] as Address, value: formatValue(values[1]), data: values[2] as Hex, call: decodeCall(values[2] as Hex) }];
      }
      if (item.name === "executeBatch" && item.inputs.length === 3) {
        const targets = values[0] as Address[];
        const vals = values[1] as bigint[];
        const datas = values[2] as Hex[];
        call.inner = targets.map((t, i) => ({ target: t, value: formatValue(vals[i] ?? 0n), data: datas[i] ?? "0x", call: decodeCall(datas[i]) }));
      }
      return call;
    } catch {
      /* try next candidate */
    }
  }
  return undefined;
}

export function describeSelector(sel: string): string | undefined {
  const f = fnBySelector.get(sel)?.[0];
  if (f) return `${f.contract}.${f.item.name}`;
  const e = errBySelector.get(sel)?.[0];
  if (e) return `${e.contract}.${e.item.name}`;
  return undefined;
}
