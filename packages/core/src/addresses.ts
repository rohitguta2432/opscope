import type { Address, Hex } from "viem";

/** Canonical EntryPoint v0.7 (same address on every chain, CREATE2 via the deterministic deployer). */
export const ENTRYPOINT_V07: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
/** Recognised so OpScope can say "unsupported" instead of guessing. */
export const ENTRYPOINT_V06: Address = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
export const ENTRYPOINT_V08: Address = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

/** SenderCreator deployed by the canonical v0.7 EntryPoint constructor (CREATE nonce 1). */
export const SENDER_CREATOR_V07: Address = "0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C";
/** Arachnid deterministic deployment proxy, pre-deployed on Anvil. */
export const CREATE2_DEPLOYER: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
/** Salt eth-infinitism used to deploy EntryPoint v0.7. */
export const ENTRYPOINT_V07_SALT: Hex = "0x90d8084deab30c2a37c45e8d47f49f2f7965183cb6990a98943ef94940681de3";

/** EIP-1967 implementation slot, read to identify proxied account implementations. */
export const EIP1967_IMPLEMENTATION_SLOT: Hex = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type EntryPointVersion = "0.6" | "0.7" | "0.8";

export interface EntryPointInfo {
  version: EntryPointVersion;
  address: Address;
  supported: boolean;
  label: string;
}

export const ENTRYPOINTS: EntryPointInfo[] = [
  { version: "0.7", address: ENTRYPOINT_V07, supported: true, label: "EntryPoint v0.7" },
  { version: "0.6", address: ENTRYPOINT_V06, supported: false, label: "EntryPoint v0.6" },
  { version: "0.8", address: ENTRYPOINT_V08, supported: false, label: "EntryPoint v0.8" },
];

export function findEntryPoint(address: string): EntryPointInfo | undefined {
  return ENTRYPOINTS.find((e) => e.address.toLowerCase() === address.toLowerCase());
}

export const sameAddress = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Runtime code hashes of the canonical v0.7 deployments (verified against Base Sepolia). */
export const KNOWN_CODE: Record<string, { label: string; codeHash: Hex }> = {
  entryPointV07: { label: "EntryPoint v0.7.0 (canonical)", codeHash: "0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58" },
  senderCreatorV07: { label: "SenderCreator v0.7.0", codeHash: "0x283c9d14378f5f4c4e24045b87d621d48443fa5b4af7dd7180a599b3756a7689" },
  simpleAccountFactoryV07: { label: "SimpleAccountFactory v0.7.0", codeHash: "0xef864ebcb05608afdd25888b657deb36cdee118a2b4e0adbbe47e26f938ded45" },
  simpleAccountV07: { label: "SimpleAccount v0.7.0 (eth-infinitism)", codeHash: "0x7451513d9195948ec8f943beeaa7b7551371f1cbb89f984dbff998cdcb9acded" },
};
export const SIMPLE_ACCOUNT_FACTORY_V07: Address = "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985";
