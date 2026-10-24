import { chainName, decodeCall, eth, gasNum, gwei, nonceParts, sameAddress, short, units, type Evidence } from "@opscope/core";
import { Addr, CopyButton, KV, Section } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function OperationTab({ e }: { e: Evidence }) {
  const op = e.userOp;
  const label = (a?: string) => (a ? Object.entries(e.labels).find(([k]) => sameAddress(k, a))?.[1] : undefined);
  const call = decodeCall(op.callData);
  const n = nonceParts(BigInt(op.nonce));
  const gasRows: [string, string | undefined][] = [
    ["verificationGasLimit", op.verificationGasLimit],
    ["callGasLimit", op.callGasLimit],
    ["paymasterVerificationGasLimit", op.paymasterVerificationGasLimit],
    ["paymasterPostOpGasLimit", op.paymasterPostOpGasLimit],
    ["preVerificationGas", op.preVerificationGas],
  ];
  const totalGas = gasRows.reduce((a, [, v]) => a + (v ? BigInt(v) : 0n), 0n);
  const prefund = totalGas * BigInt(op.maxFeePerGas);
  const pf = e.preflight.userOpHash;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="panel min-w-0 px-4 py-2">
        <div className="flex items-center justify-between py-2">
          <h3 className="eyebrow">UserOperation · v0.7 RPC fields</h3>
          <CopyButton value={JSON.stringify(op, null, 2)} label="Copy operation JSON" />
        </div>
        {e.inputWarnings.length > 0 && (
          <ul className="mb-2 space-y-1 rounded-md border border-sand-line bg-sand-soft px-3 py-2 text-[12px] text-fg-2">
            {e.inputWarnings.map((w) => (
              <li key={w}>! {w}</li>
            ))}
          </ul>
        )}
        <dl>
          <KV k="sender">
            <Addr address={op.sender} label={label(op.sender)} />
          </KV>
          <KV k="nonce">
            <span className="mono text-[12.5px]">{op.nonce}</span>
            <span className="ml-2 text-[12px] text-fg-3">
              key {n.key.toString()} · sequence {n.sequence.toString()}
            </span>
          </KV>
          {op.factory && (
            <KV k="factory">
              <Addr address={op.factory} label={label(op.factory)} />
            </KV>
          )}
          <KV k="callData">
            {call ? (
              <div className="space-y-1">
                <div className="text-[13px]">
                  <span className="text-fg-2">{call.contract}</span>
                  <span className="mono text-fg">.{call.fn}</span>
                </div>
                {call.inner?.map((i, k) => (
                  <div key={k} className="flex flex-wrap items-baseline gap-x-1.5 text-[12.5px]">
                    <span className="text-fg-3">→</span>
                    <span className="text-fg-2">{label(i.target) ?? short(i.target)}</span>
                    {i.call ? (
                      <span className="mono text-fg">
                        .{i.call.fn}(
                        {i.call.args
                          .map((a) => (a.type === "address" ? (label(a.value) ?? short(a.value)) : e.tokens[i.target] && a.type.startsWith("uint") ? units(a.value, e.tokens[i.target]!.decimals, e.tokens[i.target]!.symbol) : short(a.value, 12, 4)))
                          .join(", ")}
                        )
                      </span>
                    ) : (
                      <span className="mono text-fg-3">{i.data.slice(0, 10)}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <span className="mono text-[12px] text-fg-3">{op.callData === "0x" ? "empty" : `${op.callData.slice(0, 10)}… (unknown selector)`}</span>
            )}
          </KV>
          {gasRows
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => (
              <KV key={k} k={k} mono>
                {gasNum(v!)}
              </KV>
            ))}
          <KV k="maxFeePerGas" mono>
            {gwei(op.maxFeePerGas)}
          </KV>
          <KV k="maxPriorityFeePerGas" mono>
            {gwei(op.maxPriorityFeePerGas)}
          </KV>
          {op.paymaster && (
            <KV k="paymaster">
              <Addr address={op.paymaster} label={label(op.paymaster)} />
              {op.paymasterData && op.paymasterData !== "0x" && <div className="mono mt-0.5 text-[11.5px] text-fg-3">data {short(op.paymasterData, 14, 6)}</div>}
            </KV>
          )}
          <KV k="signature">
            <span className="mono text-[12px]">{short(op.signature, 14, 8)}</span>
            <span className="ml-2 text-[12px] text-fg-3">{(op.signature.length - 2) / 2} bytes</span>
          </KV>
        </dl>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="panel p-4">
          <Section title="Required prefund">
            <div className="mono space-y-1 text-[12.5px]">
              {gasRows
                .filter(([, v]) => v !== undefined)
                .map(([k, v], i) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="truncate text-fg-3">
                      {i === 0 ? "  " : "+ "}
                      {k}
                    </span>
                    <span className="text-fg-2">{gasNum(v!)}</span>
                  </div>
                ))}
              <div className="flex justify-between gap-3 border-t border-line pt-1">
                <span className="text-fg-3">= gas</span>
                <span className="text-fg">{gasNum(totalGas)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-fg-3">× maxFeePerGas</span>
                <span className="text-fg">{gwei(op.maxFeePerGas)}</span>
              </div>
              <div className="flex justify-between gap-3 border-t border-line pt-1.5 text-[14px]">
                <span className="text-fg-2">prefund</span>
                <span className="font-semibold text-lav">{eth(prefund)}</span>
              </div>
            </div>
            <p className="mt-2.5 text-[12px] leading-snug text-fg-3">
              Locked up front by EntryPoint from {op.paymaster ? "the paymaster's" : "the account's"} deposit; the unused part is refunded after execution.
            </p>
          </Section>
        </div>
        <div className="panel p-4">
          <Section title="userOpHash">
            <div className="flex items-center gap-1.5">
              <code className="mono min-w-0 break-all text-[12px] text-fg">{e.userOpHash}</code>
              <CopyButton value={e.userOpHash} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-fg-3">
              <Badge tone={pf.matches ? "lime" : pf.entryPoint ? "rose" : "neutral"}>{pf.matches ? "EntryPoint agrees" : pf.entryPoint ? "mismatch" : "not checked"}</Badge>
              <span>
                keccak(abi.encode(hash(op), {short(e.entryPoint)}, {e.chainId})) · {chainName(e.chainId)}
              </span>
            </div>
          </Section>
        </div>
        <div className="panel p-4">
          <Section title="Packed (on-chain calldata struct)">
            <dl className="mono space-y-1.5 text-[11.5px]">
              {Object.entries(e.packed).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[132px_1fr] gap-2">
                  <dt className="text-fg-3">{k}</dt>
                  <dd className={cn("min-w-0 break-all text-fg-2", String(v).length > 70 && "line-clamp-2")}>{String(v)}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
