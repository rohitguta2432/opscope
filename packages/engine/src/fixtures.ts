import { encodeFunctionData, keccak256, parseEther, parseGwei, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ENTRYPOINT_V07,
  SENDER_CREATOR_V07,
  getUserOpHashV07,
  packUserOp,
  type FixtureInfo,
  type UserOperationV07,
} from "@opscope/core";
import { startAnvil, type AnvilHandle } from "./anvil";
import { artifacts } from "./artifacts";
import { deploy, deployCanonical, setAutomine, write } from "./deploy";
import { clientFor, rpc, sendAndWait, type Client } from "./rpc";

/** Fixture chains are pinned: same genesis time, 12 s blocks, 1 gwei base fee → identical block hashes every run. */
export const FIXTURE_GENESIS_TS = 1767225600; // 2026-01-01T00:00:00Z
export const FIXTURE_CHAIN_ID = 31337;
export const FIXTURE_BASE_FEE = parseGwei("1");

/** Anvil's default dev accounts (the published test mnemonic). Local fixture chains only. */
export const DEV = {
  bundler: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  deployer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  alice: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  bob: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
} as const satisfies Record<string, Address>;

/** Deterministic owner key derived from a public label. It only ever signs on local fixture chains. */
const OWNER = privateKeyToAccount(keccak256(toHex("opscope fixture owner v1")));

export const FIXTURES: FixtureInfo[] = [
  {
    id: "paymaster-deposit",
    version: 1,
    title: "Insufficient paymaster deposit",
    summary: "A sponsored transfer whose paymaster has 0.0005 ETH deposited against a 0.002 ETH prefund.",
    demo: true,
    expectedCode: "AA31",
  },
  {
    id: "invalid-signature",
    version: 1,
    title: "Invalid wallet signature",
    summary: "The owner signed the userOpHash for chain 1 instead of the chain the operation targets.",
    demo: true,
    expectedCode: "AA24",
  },
  {
    id: "token-balance",
    version: 1,
    title: "Token transfer exceeding balance",
    summary: "Second of two operations in one block sends 250 DEMO after the first left 100. Included, execution reverted.",
    demo: true,
    expectedCode: "EXECUTION_REVERTED",
  },
  {
    id: "nonce-mismatch",
    version: 1,
    title: "Nonce already used",
    summary: "A retry reuses nonce 0 after the original operation was included.",
    demo: false,
    expectedCode: "AA25",
  },
  {
    id: "account-prefund",
    version: 1,
    title: "Insufficient account prefund",
    summary: "A self-paying account holds 0.0002 ETH against a 0.0016 ETH prefund.",
    demo: false,
    expectedCode: "AA21",
  },
  {
    id: "paymaster-rejects",
    version: 1,
    title: "Paymaster refuses sender",
    summary: "The sponsor's allowlist doesn't include this account; validatePaymasterUserOp reverts.",
    demo: false,
    expectedCode: "AA33",
  },
];

export interface FixtureEnv {
  info: FixtureInfo;
  anvil: AnvilHandle;
  client: Client;
  userOp: UserOperationV07;
  /** set for fixtures whose operation was included on-chain */
  inclusionTx?: Hex;
  labels: Record<string, string>;
  addresses: { entryPoint: Address; factory: Address; account: Address; paymaster: Address; token: Address; owner: Address };
  stop(): Promise<void>;
}

const GAS = {
  verificationGasLimit: 150_000n,
  callGasLimit: 120_000n,
  preVerificationGas: 50_000n,
  maxFeePerGas: parseGwei("5"),
  maxPriorityFeePerGas: parseGwei("1"),
};

function transferCall(token: Address, to: Address, amount: bigint): Hex {
  const inner = encodeFunctionData({ abi: artifacts.DemoToken.abi, functionName: "transfer", args: [to, amount] });
  return encodeFunctionData({ abi: artifacts.SimpleAccount.abi, functionName: "execute", args: [token, 0n, inner] });
}

async function sign(op: UserOperationV07, chainId: number): Promise<Hex> {
  return OWNER.signMessage({ message: { raw: getUserOpHashV07(op, ENTRYPOINT_V07, chainId) } });
}

export function handleOpsData(ops: UserOperationV07[], beneficiary: Address): Hex {
  return encodeFunctionData({
    abi: artifacts.EntryPoint.abi,
    functionName: "handleOps",
    args: [ops.map((o) => packUserOp(o)), beneficiary],
  });
}

export async function buildFixture(id: string, opts: { anvilPath?: string; signal?: AbortSignal; port?: number } = {}): Promise<FixtureEnv> {
  const info = FIXTURES.find((f) => f.id === id);
  if (!info) throw new Error(`Unknown fixture "${id}". Known: ${FIXTURES.map((f) => f.id).join(", ")}`);

  const anvil = await startAnvil({
    anvilPath: opts.anvilPath,
    chainId: FIXTURE_CHAIN_ID,
    timestamp: FIXTURE_GENESIS_TS,
    baseFee: FIXTURE_BASE_FEE,
    signal: opts.signal,
    port: opts.port,
  });
  try {
    const client = clientFor(anvil.url);
    await rpc(client, "anvil_setBlockTimestampInterval", [12]);

    const { entryPoint, simpleAccountFactory: factory } = await deployCanonical(client, DEV.deployer);
    const token = await deploy(client, DEV.deployer, artifacts.DemoToken);
    const paymaster = await deploy(client, DEV.deployer, artifacts.SponsorPaymaster, [entryPoint]);
    await write(client, DEV.deployer, factory, artifacts.SimpleAccountFactory.abi, "createAccount", [OWNER.address, 0n]);
    const account = (await client.readContract({
      address: factory,
      abi: artifacts.SimpleAccountFactory.abi,
      functionName: "getAddress",
      args: [OWNER.address, 0n],
    })) as Address;

    const labels: Record<string, string> = {
      [entryPoint]: "EntryPoint v0.7",
      [SENDER_CREATOR_V07]: "SenderCreator",
      [factory]: "SimpleAccountFactory",
      [account]: "Smart account",
      [paymaster]: "SponsorPaymaster",
      [token]: "DemoToken",
      [OWNER.address]: "Account owner",
      [DEV.alice]: "Alice",
      [DEV.bob]: "Bob",
      [DEV.bundler]: "Fixture bundler",
    };

    const sponsored = (o: UserOperationV07): UserOperationV07 => ({
      ...o,
      paymaster,
      paymasterVerificationGasLimit: 60_000n,
      paymasterPostOpGasLimit: 20_000n,
      paymasterData: "0x",
    });
    const base = (nonce: bigint, callData: Hex): UserOperationV07 => ({ sender: account, nonce, callData, ...GAS, signature: "0x" });
    const signed = async (o: UserOperationV07, chainId = FIXTURE_CHAIN_ID) => ({ ...o, signature: await sign(o, chainId) });
    const depositFor = (who: Address, eth: string) =>
      write(client, DEV.deployer, entryPoint, artifacts.EntryPoint.abi, "depositTo", [who], parseEther(eth));
    const sponsor = (who: Address) => write(client, DEV.deployer, paymaster, artifacts.SponsorPaymaster.abi, "setSponsored", [who, true]);
    const mint = (to: Address, amount: string) => write(client, DEV.deployer, token, artifacts.DemoToken.abi, "mint", [to, parseEther(amount)]);
    const submit = async (ops: UserOperationV07[]) => {
      const { hash, receipt } = await sendAndWait(client, { from: DEV.bundler, to: entryPoint, data: handleOpsData(ops, DEV.bundler), gas: 1_000_000n });
      if (receipt?.status !== "success") throw new Error(`fixture handleOps failed: ${hash}`);
      return hash;
    };

    let userOp: UserOperationV07;
    let inclusionTx: Hex | undefined;

    switch (id) {
      case "paymaster-deposit": {
        await mint(account, "300");
        await sponsor(account);
        await depositFor(paymaster, "0.0005");
        userOp = await signed(sponsored(base(0n, transferCall(token, DEV.alice, parseEther("25")))));
        break;
      }
      case "invalid-signature": {
        await mint(account, "300");
        await depositFor(account, "0.05");
        // signed for Ethereum mainnet's chain id instead of 31337
        userOp = await signed(base(0n, transferCall(token, DEV.alice, parseEther("25"))), 1);
        break;
      }
      case "token-balance": {
        await mint(account, "300");
        await sponsor(account);
        await depositFor(paymaster, "1");
        const first = await signed(sponsored(base(0n, transferCall(token, DEV.alice, parseEther("200")))));
        userOp = await signed(sponsored(base(1n, transferCall(token, DEV.bob, parseEther("250")))));
        // both bundles land in the same block: the second only fails because of the first
        await setAutomine(client, false);
        const nonce = await client.getTransactionCount({ address: DEV.bundler });
        const a = await sendAndWait(client, { from: DEV.bundler, to: entryPoint, data: handleOpsData([first], DEV.bundler), gas: 1_000_000n, nonce }, { wait: false });
        const b = await sendAndWait(client, { from: DEV.bundler, to: entryPoint, data: handleOpsData([userOp], DEV.bundler), gas: 1_000_000n, nonce: nonce + 1 }, { wait: false });
        await rpc(client, "evm_mine", []);
        await setAutomine(client, true);
        for (const h of [a.hash, b.hash]) {
          const r = await client.getTransactionReceipt({ hash: h });
          if (r.status !== "success") throw new Error(`fixture bundle ${h} reverted`);
        }
        inclusionTx = b.hash;
        break;
      }
      case "nonce-mismatch": {
        await mint(account, "300");
        await depositFor(account, "0.05");
        await submit([await signed(base(0n, transferCall(token, DEV.alice, parseEther("10"))))]);
        // a retry built from a stale nonce cache
        userOp = await signed(base(0n, transferCall(token, DEV.alice, parseEther("12"))));
        break;
      }
      case "account-prefund": {
        await mint(account, "300");
        await sendAndWait(client, { from: DEV.deployer, to: account, data: "0x", value: parseEther("0.0002") });
        userOp = await signed(base(0n, transferCall(token, DEV.alice, parseEther("25"))));
        break;
      }
      case "paymaster-rejects": {
        await mint(account, "300");
        await depositFor(paymaster, "1");
        userOp = await signed(sponsored(base(0n, transferCall(token, DEV.alice, parseEther("25")))));
        break;
      }
      default:
        throw new Error(`fixture ${id} has no setup`);
    }

    return {
      info,
      anvil,
      client,
      userOp,
      inclusionTx,
      labels,
      addresses: { entryPoint, factory, account, paymaster, token, owner: OWNER.address },
      stop: () => anvil.stop(),
    };
  } catch (e) {
    await anvil.stop();
    throw e;
  }
}
