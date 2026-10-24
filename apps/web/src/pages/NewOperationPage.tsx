import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, KeyRound, Lock, Play, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { ENTRYPOINT_V07, chainName, eth, getUserOpHashV07, parseUserOpInput, requiredPrefund, short, type BlockSelector, type InputIssue } from "@opscope/core";
import { api, ApiError } from "@/lib/api";
import { go, hrefSession } from "@/lib/router";
import { takePrefill } from "@/lib/prefill";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const JsonEditor = lazy(() => import("@/components/JsonEditor").then((m) => ({ default: m.JsonEditor })));

const TEMPLATE = `{
  "sender": "0x…",
  "nonce": "0x0",
  "callData": "0x",
  "callGasLimit": "0x1d4c0",
  "verificationGasLimit": "0x249f0",
  "preVerificationGas": "0xc350",
  "maxFeePerGas": "0x12a05f200",
  "maxPriorityFeePerGas": "0x3b9aca00",
  "signature": "0x"
}`;

type BlockKind = BlockSelector["kind"];

export function NewOperationPage() {
  const qc = useQueryClient();
  const { theme } = useTheme();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const prefill = useMemo(() => takePrefill(), []);
  const [json, setJson] = useState(prefill?.json ?? TEMPLATE);
  const [chainId, setChainId] = useState<number | undefined>(prefill?.chainId);
  const [entryPoint, setEntryPoint] = useState(prefill?.entryPoint ?? ENTRYPOINT_V07);
  const [connectionId, setConnectionId] = useState<string>(prefill?.connectionId ?? "");
  const [blockKind, setBlockKind] = useState<BlockKind>(prefill?.block?.kind ?? "latest");
  const [blockValue, setBlockValue] = useState(prefill?.block?.kind === "number" ? prefill.block.number : prefill?.block?.kind === "inclusion" ? prefill.block.txHash : "");
  const [replay, setReplay] = useState(true);
  const [serverIssues, setServerIssues] = useState<InputIssue[]>([]);

  const conns = config.data?.connections ?? [];
  useEffect(() => {
    if (!connectionId && conns.length) {
      const pick = conns.find((c) => c.available && (!chainId || c.chainId === chainId)) ?? conns.find((c) => c.available) ?? conns[0]!;
      setConnectionId(pick.id);
      setChainId((c) => c ?? pick.chainId);
    }
  }, [conns, connectionId, chainId]);
  const conn = conns.find((c) => c.id === connectionId);

  const [debounced, setDebounced] = useState(json);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(json), 250);
    return () => clearTimeout(t);
  }, [json]);
  const parsed = useMemo(() => parseUserOpInput(debounced), [debounced]);
  const issues = parsed.ok ? serverIssues : parsed.issues;
  const effChain = chainId ?? (parsed.ok ? parsed.chainId : undefined) ?? conn?.chainId;
  const hash = parsed.ok && effChain ? getUserOpHashV07(parsed.op, entryPoint as `0x${string}`, effChain) : undefined;
  const epInfo = config.data?.entryPoints.find((e) => e.address.toLowerCase() === entryPoint.toLowerCase());

  const run = useMutation({
    mutationFn: () => {
      const block: BlockSelector = blockKind === "number" ? { kind: "number", number: blockValue.trim() } : blockKind === "inclusion" ? { kind: "inclusion", txHash: blockValue.trim() as `0x${string}` } : { kind: "latest" };
      return api.start({ userOp: JSON.parse(json), chainId: effChain!, entryPoint: entryPoint as `0x${string}`, connection: { kind: "rpc", id: connectionId }, block, mode: replay ? "preflight+replay" : "preflight" });
    },
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      go(hrefSession(id));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.issues) setServerIssues(e.issues);
      toast.error((e as Error).message);
    },
  });
  const blockOk = blockKind === "latest" || (blockKind === "number" ? /^\d+$/.test(blockValue.trim()) : /^0x[0-9a-fA-F]{64}$/.test(blockValue.trim()));
  const canRun = parsed.ok && !!effChain && !!connectionId && blockOk && !run.isPending;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 lg:px-7 lg:py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[21px] font-bold">New operation</h1>
          <p className="mt-0.5 text-[13px] text-fg-2">Paste a v0.7 UserOperation: the RPC form, the packed struct, or the eth_sendUserOperation params from your bundler error.{prefill?.source && <span className="text-fg-3"> Imported from {prefill.source}.</span>}</p>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="panel min-w-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="eyebrow">userop.json</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setJson(TEMPLATE)}>
                <Wand2 /> v0.7 template
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  try {
                    setJson(JSON.stringify(JSON.parse(json), null, 2));
                  } catch {
                    toast.error("Not valid JSON yet");
                  }
                }}
              >
                Format
              </Button>
            </div>
          </div>
          <Suspense fallback={<div className="h-[560px] bg-sunken" />}>
            <JsonEditor value={json} onChange={(v) => { setJson(v); setServerIssues([]); }} issues={issues} theme={theme} />
          </Suspense>
          <div className={cn("border-t px-4 py-2.5 text-[12.5px]", parsed.ok ? "border-line" : "border-rose-line bg-rose-soft")}>
            {parsed.ok ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex items-center gap-1.5 text-lime">
                  <CircleCheck className="size-3.5" /> valid v0.7 {parsed.format === "packed" ? "packed struct" : "RPC operation"}
                </span>
                {hash && (
                  <span className="mono text-fg-3">
                    userOpHash <span className="text-fg-2">{short(hash, 10, 8)}</span>
                  </span>
                )}
                <span className="mono text-fg-3">
                  prefund <span className="text-fg-2">{eth(requiredPrefund(parsed.op))}</span>
                </span>
                {parsed.op.paymaster && <span className="mono text-fg-3">sponsored by {short(parsed.op.paymaster)}</span>}
                {parsed.warnings.map((w) => (
                  <span key={w} className="text-sand">! {w}</span>
                ))}
              </div>
            ) : (
              <ul className="space-y-0.5">
                {parsed.issues.slice(0, 6).map((i) => (
                  <li key={`${i.path}${i.message}`} className="flex items-start gap-1.5 text-fg">
                    <CircleX className="mt-0.5 size-3.5 shrink-0 text-rose" />
                    <span>
                      <span className="mono text-rose">{i.path}</span> {i.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel space-y-4 p-4">
            <Field label="Chain">
              <select value={effChain ?? ""} onChange={(e) => setChainId(Number(e.target.value))} className="h-9 w-full rounded-md border border-line-strong bg-raised px-2.5 text-[13px] text-fg outline-none focus:border-lav">
                {!effChain && <option value="">Select a chain</option>}
                {config.data?.chains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="EntryPoint">
              <div className="space-y-1.5">
                {config.data?.entryPoints.map((ep) => (
                  <label key={ep.address} className={cn("flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 transition-colors", entryPoint.toLowerCase() === ep.address.toLowerCase() ? "border-lav-line bg-lav-soft" : "border-line hover:border-line-strong")}>
                    <input type="radio" name="ep" className="accent-[var(--lav)]" checked={entryPoint.toLowerCase() === ep.address.toLowerCase()} onChange={() => setEntryPoint(ep.address)} />
                    <span className="flex-1 text-[13px]">{ep.label}</span>
                    <span className="mono text-[11px] text-fg-3">{short(ep.address, 6, 4)}</span>
                    {!ep.supported && <Badge tone="sand">unsupported</Badge>}
                  </label>
                ))}
                {epInfo && !epInfo.supported && <p className="text-[11.5px] text-sand">OpScope will report this as an unsupported configuration instead of guessing.</p>}
              </div>
            </Field>
            <Field label="RPC connection" hint={<span className="flex items-center gap-1"><Lock className="size-3" /> server-side</span>}>
              <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} className="h-9 w-full rounded-md border border-line-strong bg-raised px-2.5 text-[13px] text-fg outline-none focus:border-lav">
                {conns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} · {c.available ? c.host : "not configured"}
                  </option>
                ))}
              </select>
              {conn && !conn.available && <p className="mt-1.5 text-[11.5px] leading-snug text-sand">{conn.problem}</p>}
              {conn && effChain && conn.chainId !== effChain && <p className="mt-1.5 text-[11.5px] text-sand">This connection is for chain {conn.chainId} ({chainName(conn.chainId)}); the run will report a chain mismatch.</p>}
              <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-fg-3">
                <KeyRound className="mt-px size-3 shrink-0" /> URLs and keys live in opscope.config.json on the server. The browser only ever sees connection names and hosts.
              </p>
            </Field>
            <Field label="Replay block">
              <div className="grid grid-cols-3 rounded-md border border-line-strong p-0.5">
                {(["latest", "number", "inclusion"] as BlockKind[]).map((k) => (
                  <button key={k} type="button" onClick={() => setBlockKind(k)} className={cn("h-7 cursor-pointer rounded text-[12.5px] transition-colors", blockKind === k ? "bg-lav-soft text-fg" : "text-fg-3 hover:text-fg-2")}>
                    {k === "latest" ? "Latest" : k === "number" ? "Block #" : "Included tx"}
                  </button>
                ))}
              </div>
              {blockKind !== "latest" && (
                <input value={blockValue} onChange={(e) => setBlockValue(e.target.value)} placeholder={blockKind === "number" ? "e.g. 18240115" : "0x… handleOps transaction hash"} className={cn("mono mt-2 h-9 w-full rounded-md border bg-raised px-2.5 text-[12.5px] text-fg outline-none placeholder:text-fg-3 focus:border-lav", blockValue && !blockOk ? "border-rose-line" : "border-line-strong")} />
              )}
              <p className="mt-1.5 text-[11.5px] leading-snug text-fg-3">
                {blockKind === "inclusion" ? "Forks at the exact state before that transaction, replaying any earlier transactions in its block, then re-executes the original bundle." : "The fork is pinned to this block by number and hash."}
              </p>
            </Field>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line px-3 py-2.5">
              <input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} className="mt-0.5 accent-[var(--lav)]" />
              <span>
                <span className="block text-[13px] text-fg">Local replay on an isolated Anvil fork</span>
                <span className="block text-[11.5px] leading-snug text-fg-3">Off = bundler-style preflight only (reads + simulateValidation). Nothing is ever broadcast.</span>
              </span>
            </label>
            <Button variant="primary" size="lg" className="w-full" disabled={!canRun} onClick={() => run.mutate()}>
              <Play /> {run.isPending ? "Starting…" : "Run inspection"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-fg-2">{label}</span>
        {hint && <span className="text-[11px] text-fg-3">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
