import { formatEther, formatGwei, formatUnits } from "viem";

export const short = (hex?: string, head = 6, tail = 4) =>
  !hex ? "—" : hex.length <= head + tail + 2 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;

/** "0.0015 ETH" with up to 6 significant decimals, no float drift. */
export function eth(wei: bigint | string, symbol = "ETH"): string {
  const s = formatEther(BigInt(wei));
  return `${trim(s, 6)} ${symbol}`;
}

export function gwei(wei: bigint | string): string {
  return `${trim(formatGwei(BigInt(wei)), 3)} gwei`;
}

export function units(v: bigint | string, decimals: number, symbol?: string): string {
  const s = trim(formatUnits(BigInt(v), decimals), 6);
  return symbol ? `${s} ${symbol}` : s;
}

export function gasNum(v: bigint | string): string {
  return BigInt(v).toLocaleString("en-US");
}

function trim(s: string, maxDecimals: number) {
  const [i, d = ""] = s.split(".");
  const dd = d.slice(0, maxDecimals).replace(/0+$/, "");
  return dd ? `${i}.${dd}` : i!;
}
