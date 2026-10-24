import {
  concat,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  pad,
  type Address,
  type Hex,
} from "viem";
import { CREATE2_DEPLOYER, ENTRYPOINT_V07, ENTRYPOINT_V07_SALT, SENDER_CREATOR_V07 } from "@opscope/core";
import { artifacts } from "./artifacts";
import { rpc, sendAndWait, type Client } from "./rpc";

export const ZERO_SALT: Hex = pad("0x0", { size: 32 });

export function create2Address(salt: Hex, initCode: Hex): Address {
  return getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt, bytecodeHash: keccak256(initCode) });
}

/** Deploys initCode through the deterministic deployer unless the address already has code. */
export async function create2(client: Client, from: Address, salt: Hex, initCode: Hex): Promise<Address> {
  const addr = create2Address(salt, initCode);
  const code = await client.getCode({ address: addr });
  if (code && code !== "0x") return addr;
  const { receipt } = await sendAndWait(client, { from, to: CREATE2_DEPLOYER, data: concat([salt, initCode]), gas: 12_000_000n });
  if (receipt?.status !== "success") throw new Error(`CREATE2 deployment to ${addr} failed`);
  return addr;
}

export interface CanonicalDeployment {
  entryPoint: Address;
  senderCreator: Address;
  simpleAccountFactory: Address;
  simpleAccountImplementation: Address;
}

/**
 * Deploys EntryPoint v0.7 from the published release artifact with eth-infinitism's salt.
 * The result lands at the canonical 0x0000000071727De2… address with the same bytecode as
 * mainnet, and its SenderCreator at the canonical 0xEFC2c144… address.
 */
export async function deployCanonical(client: Client, from: Address): Promise<CanonicalDeployment> {
  const entryPoint = await create2(client, from, ENTRYPOINT_V07_SALT, artifacts.EntryPoint.bytecode);
  if (entryPoint.toLowerCase() !== ENTRYPOINT_V07.toLowerCase()) throw new Error(`EntryPoint landed at ${entryPoint}, expected ${ENTRYPOINT_V07}`);
  const senderCode = await client.getCode({ address: SENDER_CREATOR_V07 });
  if (!senderCode || senderCode === "0x") throw new Error("SenderCreator missing at canonical address");

  const factoryInit = concat([
    artifacts.SimpleAccountFactory.bytecode,
    encodeAbiParameters([{ type: "address" }], [entryPoint]),
  ]);
  const simpleAccountFactory = await create2(client, from, ZERO_SALT, factoryInit);
  const simpleAccountImplementation = (await client.readContract({
    address: simpleAccountFactory,
    abi: artifacts.SimpleAccountFactory.abi,
    functionName: "accountImplementation",
  })) as Address;
  return { entryPoint, senderCreator: SENDER_CREATOR_V07, simpleAccountFactory, simpleAccountImplementation };
}

/** Plain CREATE deployment from an unlocked Anvil account. */
export async function deploy(client: Client, from: Address, artifact: { abi: readonly unknown[]; bytecode: Hex }, args: unknown[] = []): Promise<Address> {
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args } as never);
  const { receipt } = await sendAndWait(client, { from, data, gas: 8_000_000n });
  if (receipt?.status !== "success" || !receipt.contractAddress) throw new Error("deployment failed");
  return getAddress(receipt.contractAddress);
}

export async function write(client: Client, from: Address, to: Address, abi: readonly unknown[], functionName: string, args: unknown[] = [], value?: bigint) {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const { hash, receipt } = await sendAndWait(client, { from, to, data, value, gas: 3_000_000n });
  if (receipt?.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  return hash;
}

export async function setAutomine(client: Client, on: boolean) {
  await rpc(client, "evm_setAutomine", [on]);
}
