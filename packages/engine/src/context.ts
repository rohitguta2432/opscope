import { getAddress, keccak256, pad, size, slice, type Address, type Hex } from "viem";
import { EIP1967_IMPLEMENTATION_SLOT, KNOWN_CODE, type ExecutionContext, type UserOperationV07 } from "@opscope/core";
import type { BlockRef, Client } from "./rpc";

const bn = (b: BlockRef) => (b === "latest" ? { blockTag: "latest" as const } : { blockNumber: b });

export async function codeInfo(client: Client, address: Address, block: BlockRef) {
  const code = await client.getCode({ address, ...bn(block) });
  const deployed = !!code && code !== "0x";
  return { deployed, codeHash: deployed ? keccak256(code!) : undefined, size: deployed ? size(code!) : 0 };
}

const knownLabel = (codeHash?: Hex) => Object.values(KNOWN_CODE).find((k) => k.codeHash === codeHash)?.label;

/** Reads the code identities the diagnosis depends on, at the pinned block. */
export async function readCodeContext(
  client: Client,
  op: UserOperationV07,
  entryPoint: Address,
  block: BlockRef,
): Promise<Pick<ExecutionContext, "entryPoint" | "account" | "paymaster">> {
  const ep = await codeInfo(client, entryPoint, block);
  const canonical = ep.codeHash === KNOWN_CODE.entryPointV07!.codeHash;
  const entryPointCtx: ExecutionContext["entryPoint"] = {
    address: entryPoint,
    version: canonical ? "0.7.0" : ep.deployed ? "unverified" : "not deployed",
    codeHash: ep.codeHash,
    canonical,
    note: canonical
      ? "Runtime code hash matches the canonical EntryPoint v0.7.0 deployment."
      : ep.deployed
        ? "Code at this address is not the canonical v0.7.0 build; results assume v0.7 semantics."
        : "No code at this address on this chain.",
  };

  const acct = await codeInfo(client, op.sender, block);
  const account: ExecutionContext["account"] = { address: op.sender, deployed: acct.deployed, codeHash: acct.codeHash };
  if (acct.deployed) {
    const direct = knownLabel(acct.codeHash);
    if (direct) account.implementation = { codeHash: acct.codeHash, label: direct, known: true };
    else {
      const slot = await client.getStorageAt({ address: op.sender, slot: EIP1967_IMPLEMENTATION_SLOT, ...bn(block) });
      const implAddr = slot && BigInt(slot) !== 0n ? getAddress(slice(pad(slot, { size: 32 }), 12)) : undefined;
      if (implAddr) {
        const impl = await codeInfo(client, implAddr, block);
        const label = knownLabel(impl.codeHash);
        account.implementation = { address: implAddr, codeHash: impl.codeHash, label: label ?? "Unrecognised implementation (ERC-1967 proxy)", known: !!label };
      } else {
        account.implementation = { label: "Unrecognised account implementation", known: false };
      }
    }
  }

  let paymaster: ExecutionContext["paymaster"];
  if (op.paymaster) {
    const pm = await codeInfo(client, op.paymaster, block);
    paymaster = { address: op.paymaster, deployed: pm.deployed, codeHash: pm.codeHash };
  }
  return { entryPoint: entryPointCtx, account, paymaster };
}

export const isSimpleAccountV07 = (ctx: Pick<ExecutionContext, "account">) =>
  ctx.account.implementation?.codeHash === KNOWN_CODE.simpleAccountV07!.codeHash;
