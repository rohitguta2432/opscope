/** Hand-off from Import to the New Operation form. Kept in memory: nothing is persisted. */
export interface Prefill {
  json: string;
  chainId?: number;
  entryPoint?: string;
  connectionId?: string;
  block?: { kind: "latest" } | { kind: "number"; number: string } | { kind: "inclusion"; txHash: string };
  source?: string;
}
let pending: Prefill | undefined;
export const setPrefill = (p: Prefill) => {
  pending = p;
};
export const takePrefill = () => {
  const p = pending;
  pending = undefined;
  return p;
};
