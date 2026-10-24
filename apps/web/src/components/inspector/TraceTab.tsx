import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { Binary, Boxes, ChevronRight, Circle, Cpu, Diamond, FileCode2, HandCoins, Terminal, TriangleAlert, Wallet } from "lucide-react";
import { parseValidationData, sameAddress, short, units, type DecodedArg, type Evidence, type TraceFrame } from "@opscope/core";
import type { Diagnosis } from "@opscope/diagnosis";
import { cn } from "@/lib/utils";
import { Addr, CopyButton, Section } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { SourceTag } from "./LifecycleScope";

const ROLE_ICON = { entrypoint: Cpu, account: Wallet, paymaster: HandCoins, factory: Boxes, senderCreator: Boxes, target: FileCode2, precompile: Binary, other: Circle } as const;
const ROLE_LABEL = { entrypoint: "EntryPoint", account: "Smart account", paymaster: "Paymaster", factory: "Factory", senderCreator: "SenderCreator", target: "Call target", precompile: "Precompile", other: "Contract" } as const;

type Row = { f: TraceFrame; depth: number; parent?: string };

function index(root: TraceFrame) {
  const byId = new Map<string, Row>();
  const walk = (f: TraceFrame, depth: number, parent?: string) => {
    byId.set(f.id, { f, depth, parent });
    f.calls.forEach((c) => walk(c, depth + 1, f.id));
  };
  walk(root, 0);
  return byId;
}

const ancestors = (id: string) => id.split(".").map((_, i, a) => a.slice(0, i + 1).join("."));

export function TraceTab({ e, d }: { e: Evidence; d: Diagnosis }) {
  const trace = e.replay.trace;
  const root = trace.status === "ok" ? trace.root : undefined;
  const focus = d.traceFocus ?? root?.id ?? "0";
  const [selected, setSelected] = useState(focus);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestors(focus)));
  useEffect(() => {
    setSelected(focus);
    setExpanded(new Set([...ancestors(focus), "0"]));
  }, [focus, e.userOpHash]);
  const rows = useMemo(() => (root ? index(root) : new Map<string, Row>()), [root]);
  const frame = rows.get(selected)?.f;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="panel flex min-h-[320px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h3 className="eyebrow">Call trace</h3>
            <span className="mono text-[11px] text-fg-3">{trace.status === "ok" ? `${trace.method} · ${rows.size} frames` : "unavailable"}</span>
          </div>
          {root ? (
            <TraceTree root={root} rows={rows} selected={selected} onSelect={setSelected} expanded={expanded} setExpanded={setExpanded} e={e} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <TriangleAlert className="size-5 text-sand" />
              <p className="max-w-sm text-[13px] text-fg-2">Trace unavailable: {trace.status === "unavailable" ? trace.reason : ""}</p>
              <p className="max-w-sm text-[12px] text-fg-3">Missing trace is missing evidence. It is not read as successful execution.</p>
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          {frame && <FramePanel f={frame} e={e} />}
          <EvidenceLedger d={d} />
        </div>
      </div>
      <NextSteps d={d} />
    </div>
  );
}

function TraceTree({ root, rows, selected, onSelect, expanded, setExpanded, e }: { root: TraceFrame; rows: Map<string, Row>; selected: string; onSelect: (id: string) => void; expanded: Set<string>; setExpanded: (s: Set<string>) => void; e: Evidence }) {
  const visible: Row[] = [];
  const walk = (f: TraceFrame) => {
    const r = rows.get(f.id)!;
    visible.push(r);
    if (expanded.has(f.id)) f.calls.forEach(walk);
  };
  walk(root);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const toggle = (id: string, open?: boolean) => {
    const next = new Set(expanded);
    if (open ?? !next.has(id)) next.add(id);
    else next.delete(id);
    setExpanded(next);
  };
  const onKey = (ev: KeyboardEvent) => {
    const i = visible.findIndex((r) => r.f.id === selected);
    const cur = visible[i];
    if (!cur) return;
    const move = (r?: Row) => {
      if (!r) return;
      ev.preventDefault();
      onSelect(r.f.id);
      ref.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(r.f.id)}"]`)?.focus();
    };
    if (ev.key === "ArrowDown") move(visible[i + 1]);
    else if (ev.key === "ArrowUp") move(visible[i - 1]);
    else if (ev.key === "Home") move(visible[0]);
    else if (ev.key === "End") move(visible[visible.length - 1]);
    else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      if (cur.f.calls.length && !expanded.has(cur.f.id)) toggle(cur.f.id, true);
      else if (cur.f.calls.length) move(rows.get(cur.f.calls[0]!.id));
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      if (expanded.has(cur.f.id) && cur.f.calls.length) toggle(cur.f.id, false);
      else if (cur.parent) move(rows.get(cur.parent));
    }
  };

  return (
    <div ref={ref} role="tree" aria-label="Call trace" onKeyDown={onKey} className="scrollbar-thin max-h-[520px] flex-1 overflow-auto py-1.5">
      {visible.map(({ f, depth }) => {
        const Icon = ROLE_ICON[f.role ?? "other"];
        const isSel = f.id === selected;
        const open = expanded.has(f.id);
        const name = f.decoded ? f.decoded.fn : f.role === "precompile" ? "" : f.input === "0x" ? "(transfer)" : f.input.slice(0, 10);
        return (
          <div
            key={f.id}
            data-id={f.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={isSel}
            aria-expanded={f.calls.length ? open : undefined}
            tabIndex={isSel ? 0 : -1}
            onClick={() => onSelect(f.id)}
            onDoubleClick={() => f.calls.length && toggle(f.id)}
            className={cn(
              "group relative flex h-[30px] cursor-pointer items-center gap-1.5 pr-3 text-[12.5px] outline-none transition-colors hover:bg-raised focus-visible:bg-raised",
              isSel && "bg-lav-soft hover:bg-lav-soft before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-lav",
            )}
            style={{ paddingLeft: 10 + depth * 16 }}
          >
            {Array.from({ length: depth }).map((_, i) => (
              <span key={i} className="absolute inset-y-0 border-l border-line" style={{ left: 17 + i * 16 }} />
            ))}
            <button
              type="button"
              tabIndex={-1}
              aria-label={open ? "Collapse" : "Expand"}
              onClick={(ev) => {
                ev.stopPropagation();
                if (f.calls.length) toggle(f.id);
              }}
              className={cn("relative z-10 flex size-4 shrink-0 items-center justify-center rounded text-fg-3", !f.calls.length && "invisible")}
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
            <span className={cn("mono shrink-0 rounded border px-1 text-[9.5px] leading-[15px]", f.type === "DELEGATECALL" ? "border-lav-line text-lav" : f.type === "STATICCALL" ? "border-line text-fg-3" : "border-line-strong text-fg-2")}>{f.type.replace("CALL", "") || "CALL"}</span>
            <Icon className="size-3.5 shrink-0 text-fg-3" />
            <span className="min-w-0 truncate">
              <span className={cn("text-fg-2", isSel && "text-fg")}>{f.label ?? short(f.to)}</span>
              {name && (
                <>
                  <span className="text-fg-3">.</span>
                  <span className={cn("mono text-[12px]", f.status === "reverted" ? "text-rose" : "text-fg")}>{name}</span>
                </>
              )}
              {f.value && f.value !== "0" && <span className="mono ml-1 text-[11px] text-sand">{units(f.value, 18, "ETH")}</span>}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
              {f.status === "reverted" && (
                <>
                  <span className="size-1.5 rounded-full bg-rose sm:hidden" />
                  <span className="mono hidden max-w-[150px] truncate rounded bg-rose-soft px-1 text-[10px] text-rose sm:inline">{f.revert?.name ?? f.revert?.aaCode ?? "revert"}</span>
                </>
              )}
              {f.decoded?.fn === "validateUserOp" && f.output && BigInt(f.output) === 1n && <span className="mono rounded bg-rose-soft px-1 text-[10px] text-rose">SIG_FAILED</span>}
              <span className="mono hidden w-[54px] text-right text-[10.5px] text-fg-3 sm:inline-block">{f.gasUsed ? Number(f.gasUsed).toLocaleString("en-US") : ""}</span>
            </span>
          </div>
        );
      })}
      <div className="sr-only">{e.userOpHash}</div>
    </div>
  );
}

function argValue(a: DecodedArg, e: Evidence, tokenFrame?: TraceFrame) {
  if (a.type === "address") {
    const label = Object.entries(e.labels).find(([k]) => sameAddress(k, a.value))?.[1];
    return <Addr address={a.value} label={label} />;
  }
  if (a.type.startsWith("uint") && tokenFrame?.to && e.tokens[tokenFrame.to] && /amount|value|balance|needed/i.test(a.name)) {
    const t = e.tokens[tokenFrame.to]!;
    return (
      <span>
        <span className="mono text-fg">{units(a.value, t.decimals, t.symbol)}</span>
        <span className="mono ml-2 text-[11px] text-fg-3">{a.value}</span>
      </span>
    );
  }
  return <span className="mono break-all text-[12px] text-fg">{a.value.length > 140 ? `${a.value.slice(0, 140)}…` : a.value}</span>;
}

function FramePanel({ f, e }: { f: TraceFrame; e: Evidence }) {
  const role = f.role ?? "other";
  const isToken = !!(f.to && e.tokens[f.to]);
  const vd = f.decoded?.fn === "validateUserOp" && f.output && f.output !== "0x" ? parseValidationData(BigInt(f.output)) : undefined;
  return (
    <motion.div key={f.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className={cn("panel overflow-hidden", f.status === "reverted" && "border-rose-line")}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="eyebrow">
            {ROLE_LABEL[role]} · {f.type} · depth {f.depth}
          </div>
          <div className="mt-1 truncate font-display text-[17px] font-bold text-fg">
            {f.label ?? short(f.to)}
            {f.decoded && <span className="mono text-[15px] font-medium text-fg-2">.{f.decoded.fn}</span>}
          </div>
        </div>
        <Badge tone={f.status === "reverted" ? "rose" : vd?.sigFailed ? "rose" : "lime"}>{f.status === "reverted" ? "reverted" : vd?.sigFailed ? "returned SIG_FAILED" : "returned"}</Badge>
      </div>
      <dl className="grid grid-cols-1 gap-x-5 gap-y-2 px-4 py-3 text-[12.5px] sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-fg-3">from</dt>
          <dd>
            <Addr address={f.from} label={Object.entries(e.labels).find(([k]) => sameAddress(k, f.from))?.[1]} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-fg-3">to</dt>
          <dd>
            <Addr address={f.to} label={f.label} />
          </dd>
        </div>
        <div>
          <dt className="text-fg-3">gas used / limit</dt>
          <dd className="mono">
            {f.gasUsed ? Number(f.gasUsed).toLocaleString("en-US") : "—"} <span className="text-fg-3">/ {f.gas ? Number(f.gas).toLocaleString("en-US") : "—"}</span>
          </dd>
        </div>
        <div>
          <dt className="text-fg-3">value</dt>
          <dd className="mono">{f.value && f.value !== "0" ? units(f.value, 18, "ETH") : "0"}</dd>
        </div>
      </dl>

      {f.decoded && (
        <div className="border-t border-line px-4 py-3">
          <div className="mono mb-2 break-all text-[11.5px] text-lav">{f.decoded.signature}</div>
          <ArgTable args={f.decoded.args} e={e} tokenFrame={isToken ? f : undefined} />
          {f.decoded.inner?.map((inn, i) => (
            <div key={i} className="mt-2.5 rounded-md border border-line bg-raised p-2.5">
              <div className="mb-1.5 text-[11.5px] text-fg-3">
                wraps → <span className="text-fg-2">{Object.entries(e.labels).find(([k]) => sameAddress(k, inn.target))?.[1] ?? short(inn.target)}</span>
                {inn.call && <span className="mono text-fg">.{inn.call.fn}</span>}
              </div>
              {inn.call && <ArgTable args={inn.call.args} e={e} tokenFrame={e.tokens[inn.target] ? { ...f, to: inn.target } : undefined} />}
            </div>
          ))}
        </div>
      )}

      {vd && (
        <div className={cn("border-t border-line px-4 py-3 text-[12.5px]", vd.sigFailed && "bg-rose-soft")}>
          <div className="eyebrow mb-1.5">validationData</div>
          <div className="mono grid grid-cols-[110px_1fr] gap-y-1 text-[12px]">
            <span className="text-fg-3">sigFailed</span>
            <span className={vd.sigFailed ? "text-rose" : "text-lime"}>{String(vd.sigFailed)}</span>
            <span className="text-fg-3">validAfter</span>
            <span>{vd.validAfter}</span>
            <span className="text-fg-3">validUntil</span>
            <span>{vd.hasExpiry ? vd.validUntil : "none"}</span>
          </div>
        </div>
      )}

      {f.revert && (
        <div className="border-t border-rose-line bg-rose-soft px-4 py-3">
          <div className="eyebrow mb-1.5 text-rose">Revert · {f.revert.kind}</div>
          <div className="mono break-all text-[12.5px] text-fg">{f.revert.message}</div>
          {f.revert.args && f.revert.kind === "custom" && (
            <div className="mt-2">
              <ArgTable args={f.revert.args} e={e} tokenFrame={isToken ? f : undefined} />
            </div>
          )}
          {f.revert.inner && <div className="mono mt-1.5 text-[12px] text-fg-2">inner: {f.revert.inner.message}</div>}
        </div>
      )}

      <details className="group border-t border-line">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2 text-[12px] text-fg-3 hover:text-fg-2">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> Raw input{f.output ? " / output" : ""}
        </summary>
        <div className="space-y-2 px-4 pb-3">
          <RawHex label="input" hex={f.input} />
          {f.output && <RawHex label="output" hex={f.output} />}
        </div>
      </details>
    </motion.div>
  );
}

function ArgTable({ args, e, tokenFrame }: { args: DecodedArg[]; e: Evidence; tokenFrame?: TraceFrame }) {
  if (!args.length) return <div className="text-[12px] text-fg-3">no arguments</div>;
  return (
    <table className="w-full text-left text-[12.5px]">
      <tbody>
        {args.map((a) => (
          <tr key={a.name} className="border-b border-line align-top last:border-0">
            <td className="w-[1%] whitespace-nowrap py-1 pr-3 text-fg-2">{a.name}</td>
            <td className="mono w-[1%] whitespace-nowrap py-1 pr-3 text-[11px] text-fg-3">{a.type.length > 24 ? "tuple" : a.type}</td>
            <td className="min-w-0 py-1">{a.type.startsWith("(") ? <span className="mono text-[11.5px] text-fg-3">{short(a.value, 40, 8)}</span> : argValue(a, e, tokenFrame)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RawHex({ label, hex }: { label: string; hex: string }) {
  return (
    <div className="rounded-md border border-line bg-sunken">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1">
        <span className="mono text-[10.5px] text-fg-3">
          {label} · {(hex.length - 2) / 2} bytes
        </span>
        <CopyButton value={hex} className="size-5" />
      </div>
      <pre className="scrollbar-thin max-h-28 overflow-auto whitespace-pre-wrap break-all px-2.5 py-1.5 text-[11px] leading-relaxed text-fg-2">{hex}</pre>
    </div>
  );
}

function EvidenceLedger({ d }: { d: Diagnosis }) {
  const num = new Map(d.observations.map((o, i) => [o.id, `O${i + 1}`]));
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="eyebrow">Evidence</h3>
        <span className="text-[11px] text-fg-3">
          {d.observations.length} observed · {d.inferences.length} inferred
        </span>
      </div>
      <div className="space-y-4 px-4 py-3.5">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="lime">observed</Badge>
            <span className="text-[11.5px] text-fg-3">read from the chain or produced by execution</span>
          </div>
          <ol className="space-y-2">
            {d.observations.map((o, i) => (
              <li key={o.id} className="grid grid-cols-[26px_1fr] gap-1.5 text-[13px] leading-snug">
                <span className="mono pt-px text-[11px] text-fg-3">O{i + 1}</span>
                <div className="min-w-0">
                  <span className="text-fg">{o.text}</span> <SourceTag source={o.source} />
                </div>
              </li>
            ))}
          </ol>
          {d.corroboration.length > 0 && (
            <ul className="mt-2.5 space-y-1 rounded-md border border-lime-line bg-lime-soft px-3 py-2">
              {d.corroboration.map((c) => (
                <li key={c} className="text-[12px] text-fg-2">
                  <span className="text-lime">✓</span> {c}
                </li>
              ))}
            </ul>
          )}
        </div>
        {d.inferences.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="lav">inferred</Badge>
              <span className="text-[11.5px] text-fg-3">explanations built on the observations</span>
            </div>
            <ul className="space-y-2.5">
              {d.inferences.map((i) => (
                <li key={i.id} className="grid grid-cols-[18px_1fr] gap-1.5 text-[13px] leading-snug">
                  <Diamond className="mt-[3px] size-3 text-lav" />
                  <div>
                    <span className="text-fg">{i.text}</span>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-3">
                      <span>confidence {i.confidence}</span>
                      {i.basedOn.length > 0 && <span>· based on</span>}
                      {i.basedOn.map((b) => (
                        <span key={b} className="mono rounded border border-line px-1 text-[10px]">
                          {num.get(b) ?? b}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(d.unknowns.length > 0 || d.limitations.length > 0) && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="sand">unknowns & limits</Badge>
            </div>
            <ul className="space-y-1.5 text-[12.5px] leading-snug">
              {d.unknowns.map((u) => (
                <li key={u} className="grid grid-cols-[18px_1fr] text-fg-2">
                  <span className="mono text-sand">?</span>
                  {u}
                </li>
              ))}
              {d.limitations.map((l) => (
                <li key={l} className="grid grid-cols-[18px_1fr] text-fg-3">
                  <span>–</span>
                  {l}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function NextSteps({ d }: { d: Diagnosis }) {
  return (
    <Section title="Suggested next steps" aside={<span className="text-[11.5px] text-fg-3">commands are for you to run; OpScope never sends transactions</span>}>
      <ol className="grid gap-3 md:grid-cols-2">
        {d.checks.map((c, i) => (
          <motion.li key={c.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }} className="panel flex min-w-0 flex-col gap-2 p-4">
            <div className="flex items-baseline gap-2.5">
              <span className="mono text-[11px] text-lav">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-display text-[14px] font-semibold text-fg">{c.title}</span>
            </div>
            <p className="pl-[26px] text-[12.5px] leading-snug text-fg-2">{c.detail}</p>
            {c.command && (
              <div className="ml-[26px] flex items-start gap-2 rounded-md border border-line bg-sunken px-2.5 py-1.5">
                <Terminal className="mt-0.5 size-3.5 shrink-0 text-fg-3" />
                <code className="scrollbar-thin min-w-0 flex-1 overflow-x-auto whitespace-pre text-[11.5px] leading-relaxed text-fg-2">{c.command}</code>
                <CopyButton value={c.command} className="size-5" />
              </div>
            )}
          </motion.li>
        ))}
      </ol>
    </Section>
  );
}
