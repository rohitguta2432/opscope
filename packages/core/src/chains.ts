export interface ChainInfo {
  id: number;
  name: string;
  testnet: boolean;
  local?: boolean;
}

/** Chains OpScope knows by name. Any chain works if a connection points at it; these get labels. */
export const CHAINS: ChainInfo[] = [
  { id: 1, name: "Ethereum", testnet: false },
  { id: 11155111, name: "Sepolia", testnet: true },
  { id: 8453, name: "Base", testnet: false },
  { id: 84532, name: "Base Sepolia", testnet: true },
  { id: 10, name: "OP Mainnet", testnet: false },
  { id: 11155420, name: "OP Sepolia", testnet: true },
  { id: 42161, name: "Arbitrum One", testnet: false },
  { id: 421614, name: "Arbitrum Sepolia", testnet: true },
  { id: 137, name: "Polygon", testnet: false },
  { id: 31337, name: "Anvil (local)", testnet: true, local: true },
];

export function chainName(id: number): string {
  return CHAINS.find((c) => c.id === id)?.name ?? `Chain ${id}`;
}
