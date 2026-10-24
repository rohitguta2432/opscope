// Dev check: deploys the canonical v0.7 contracts on a throwaway Anvil and prints addresses + code hashes.
import { keccak256 } from "viem";
import { startAnvil } from "../src/anvil";
import { deployCanonical } from "../src/deploy";
import { clientFor } from "../src/rpc";

const anvil = await startAnvil({ timestamp: 1767225600 });
try {
  const client = clientFor(anvil.url);
  const [from] = (await client.request({ method: "eth_accounts" } as never)) as `0x${string}`[];
  const d = await deployCanonical(client, from!);
  for (const [k, v] of Object.entries(d)) {
    const code = await client.getCode({ address: v });
    console.log(k.padEnd(28), v, keccak256(code ?? "0x"));
  }
} finally {
  await anvil.stop();
}
