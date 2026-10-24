import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, CircleDashed, Cpu, HandCoins, Minus, Server, Wallet, X } from "lucide-react";
import type { Check as CheckT } from "@opscope/core";
import { sourceLabel, type Diagnosis, type StageOutcome } from "@opscope/diagnosis";
import { animScale, cn } from "@/lib/utils";

const W = 1000;
const H = 132;
const BASE = 88;
const CENTERS = [125, 375, 625, 875];
const ICONS = { rpc: Server, account: Wallet, paymaster: HandCoins, execution: Cpu } as const;

type Seg = { d: string; kind: "signal" | "fail" | "dead" | "na" | "gap"; len: number };

/** Heartbeat-like complex at each stage the operation passed. */
function pulse(cx: number) {
  return `L ${cx - 34} ${BASE} Q ${cx - 27} ${BASE - 10} ${cx - 20} ${BASE} L ${cx - 9} ${BASE} L ${cx - 5} ${BASE + 7} L ${cx} ${BASE - 36} L ${cx + 6} ${BASE + 14} L ${cx + 11} ${BASE} L ${cx + 24} ${BASE} Q ${cx + 34} ${BASE - 13} ${cx + 44} ${BASE} L ${cx + 70} ${BASE}`;
}

/** The signal spikes and breaks up at the failing stage. */
function burst(cx: number) {
  const pts: string[] = [`L ${cx - 34} ${BASE}`, `Q ${cx - 27} ${BASE - 10} ${cx - 20} ${BASE}`, `L ${cx - 9} ${BASE}`, `L ${cx - 4} ${BASE + 9}`, `L ${cx + 1} ${BASE - 44}`];
  const amps = [34, 27, 30, 20, 23, 14, 16, 8, 10, 5, 5, 2];
  amps.forEach((a, i) => pts.push(`L ${cx + 6 + i * 5.6} ${BASE + (i % 2 === 0 ? a : -a)}`));
  pts.push(`L ${cx + 78} ${BASE + 1}`);
  return pts.join(" ");
}

function buildSegments(stages: StageOutcome[]): { segs: Seg[]; failX?: number } {
  const segs: Seg[] = [];
  let x = 0;
  let failX: number | undefined;
  const line = (to: number, kind: Seg["kind"]) => {
    segs.push({ d: `M ${x} ${BASE} L ${to} ${BASE}`, kind, len: to - x });
    x = to;
  };
  stages.forEach((s, i) => {
    const cx = CENTERS[i]!;
    if (failX !== undefined) return;
    line(cx - 70, "signal");
    if (s.status === "passed" || s.status === "warning") {
      segs.push({ d: `M ${x} ${BASE} ${pulse(cx)}`, kind: "signal", len: 220 });
      x = cx + 70;
    } else if (s.status === "failed") {
      segs.push({ d: `M ${x} ${BASE} ${burst(cx)}`, kind: "fail", len: 320 });
      x = cx + 78;
      failX = cx;
    } else if (s.status === "not_applicable") {
      line(cx + 70, "na");
    } else if (s.status === "unavailable") {
      line(cx + 70, "gap");
    } else {
      line(cx + 70, "dead");
    }
  });
  if (failX !== undefined) segs.push({ d: `M ${x} ${BASE + 1} L ${W} ${BASE + 1}`, kind: "dead", len: W - x });
  else line(W, "signal");
  return { segs, failX };
}

const STROKE: Record<Seg["kind"], string> = {
  signal: "var(--lav)",
  fail: "var(--rose)",
  dead: "var(--fg-3)",
  na: "var(--lav)",
  gap: "var(--sand)",
};

const STATUS_TEXT: Record<StageOutcome["status"], string> = {
  passed: "passed",
  warning: "passed · warnings",
  failed: "failed",
  not_reached: "not reached",
  not_applicable: "n/a",
  unavailable: "unavailable",
};

export function LifecycleScope({ d, animateKey }: { d: Diagnosis; animateKey: string }) {
  const stages = d.lifecycle;
  const { segs } = useMemo(() => buildSegments(stages), [stages]);
  const [open, setOpen] = useState<string | null>(null);
  const inconclusive = d.verdict === "inconclusive";
  const total = segs.reduce((a, s) => a + s.len, 0);
  let acc = 0;
  const DRAW = 1.5 * animScale();
  const checks = stages.reduce((a, s) => a + s.checks.length, 0);
  const failIdx = stages.findIndex((s) => s.status === "failed");
  const doneAt = failIdx >= 0 ? (CENTERS[failIdx]! / W) * DRAW + 0.25 : DRAW;

  return (
    <section className="panel overflow-hidden" aria-label="Lifecycle">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="eyebrow">Lifecycle</h2>
          <span className="hidden items-center gap-3 text-[11px] text-fg-3 sm:flex">
            <Legend color="var(--lav)">signal</Legend>
            <Legend color="var(--lime)" dot>
              passed
            </Legend>
            <Legend color="var(--rose)" dot>
              failed
            </Legend>
            <Legend color="var(--fg-3)" dashed>
              not reached
            </Legend>
          </span>
        </div>
        <span className="mono text-[11px] text-fg-3">
          4 stages · {checks} checks · click a stage
        </span>
      </div>

      <div className="graticule relative h-[132px]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          {segs.map((s, i) => {
            const delay = (acc / total) * DRAW;
            acc += s.len;
            const dur = (s.len / total) * DRAW;
            const stroke = s.kind === "fail" && inconclusive ? "var(--sand)" : STROKE[s.kind];
            return (
              <motion.path
                key={`${animateKey}-${i}`}
                d={s.d}
                fill="none"
                stroke={stroke}
                strokeWidth={s.kind === "dead" ? 1.4 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.kind === "dead" ? "5 6" : s.kind === "gap" ? "2 5" : undefined}
                opacity={s.kind === "na" ? 0.45 : s.kind === "dead" ? 0.7 : 1}
                vectorEffect="non-scaling-stroke"
                style={{ filter: s.kind === "signal" || s.kind === "fail" ? `drop-shadow(0 0 4px ${s.kind === "fail" ? "var(--rose-line)" : "var(--lav-line)"})` : undefined }}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: Math.max(dur, 0.05), delay, ease: "linear" }}
              />
            );
          })}
        </svg>

        {stages.map((s, i) => {
          const Icon = ICONS[s.id];
          const left = `${(CENTERS[i]! / W) * 100}%`;
          const failed = s.status === "failed";
          const passed = s.status === "passed" || s.status === "warning";
          return (
            <motion.button
              key={s.id}
              type="button"
              onClick={() => setOpen(open === s.id ? null : s.id)}
              aria-expanded={open === s.id}
              aria-label={`${s.label}: ${STATUS_TEXT[s.status]}`}
              className={cn(
                "absolute top-[8px] flex size-[34px] -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border bg-panel transition-[box-shadow,transform] hover:scale-105",
                failed && (inconclusive ? "border-sand text-sand" : "border-rose text-rose shadow-[0_0_0_4px_var(--rose-soft)]"),
                passed && "border-lime-line text-lime",
                s.status === "not_applicable" && "border-dashed border-line-strong text-fg-3",
                s.status === "not_reached" && "border-line-strong text-fg-3 opacity-70",
                s.status === "unavailable" && "border-dashed border-sand-line text-sand",
                open === s.id && "ring-2 ring-lav ring-offset-2 ring-offset-[var(--sunken)]",
              )}
              style={{ left }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: (CENTERS[i]! / W) * DRAW, duration: 0.25 }}
            >
              <Icon className="size-4" />
              {failed && !inconclusive && (
                <motion.span
                  className="absolute inset-0 rounded-full border border-rose"
                  initial={{ opacity: 0.9, scale: 1 }}
                  animate={{ opacity: 0, scale: 1.9 }}
                  transition={{ delay: doneAt, duration: 1.4 * animScale(), repeat: 2, ease: "easeOut" }}
                />
              )}
              <span
                className={cn(
                  "absolute -right-1 -top-1 flex size-[15px] items-center justify-center rounded-full border border-panel [&_svg]:size-2.5",
                  failed ? (inconclusive ? "bg-sand text-lav-ink" : "bg-rose text-[#2a0f16]") : passed ? "bg-lime text-[#17240a]" : "bg-line-strong text-fg-3",
                )}
              >
                {failed ? <X strokeWidth={3} /> : passed ? <Check strokeWidth={3} /> : s.status === "not_applicable" ? <Minus strokeWidth={3} /> : <CircleDashed strokeWidth={3} />}
              </span>
            </motion.button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 border-t border-line md:grid-cols-4">
        {stages.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOpen(open === s.id ? null : s.id)}
            className={cn("cursor-pointer border-line px-4 py-3 text-left transition-colors hover:bg-raised [&:not(:last-child)]:border-r", open === s.id && "bg-lav-soft")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-[13.5px] font-semibold text-fg">{s.label}</span>
              <span className="mono text-[10.5px] text-fg-3">{s.checks.length}</span>
            </div>
            <div className={cn("mono mt-0.5 text-[11px] uppercase tracking-[0.06em]", s.status === "failed" ? (inconclusive ? "text-sand" : "text-rose") : s.status === "passed" || s.status === "warning" ? "text-lime" : s.status === "unavailable" ? "text-sand" : "text-fg-3")}>
              {STATUS_TEXT[s.status]}
            </div>
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-fg-2">{s.summary}</p>
          </button>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div key={open} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden border-t border-line">
            <StageChecks stage={stages.find((s) => s.id === open)!} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function StageChecks({ stage }: { stage: StageOutcome }) {
  if (!stage.checks.length) return <p className="px-4 py-3 text-[12.5px] text-fg-3">No preflight checks apply to this stage; its outcome comes from the replay.</p>;
  return (
    <ul className="divide-y divide-line">
      {stage.checks.map((c) => (
        <li key={c.id} className="grid grid-cols-[20px_1fr] gap-x-3 px-4 py-2.5 sm:grid-cols-[20px_180px_1fr_auto]">
          <CheckIcon status={c.status} />
          <span className="text-[13px] font-medium text-fg">{c.label}</span>
          <span className="col-start-2 text-[12.5px] text-fg-2 sm:col-start-auto">{c.detail}</span>
          <span className="col-start-2 flex gap-1.5 sm:col-start-auto">
            <SourceTag source={c.source} />
            <span className={cn("mono rounded border px-1 text-[10px] uppercase", c.basis === "policy" ? "border-sand-line text-sand" : "border-line text-fg-3")}>{c.basis}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CheckIcon({ status }: { status: CheckT["status"] }) {
  const map = {
    pass: ["bg-lime-soft text-lime border-lime-line", <Check key="i" strokeWidth={3} />],
    fail: ["bg-rose-soft text-rose border-rose-line", <X key="i" strokeWidth={3} />],
    warn: ["bg-sand-soft text-sand border-sand-line", <span key="i">!</span>],
    info: ["bg-lav-soft text-lav border-lav-line", <span key="i">i</span>],
    unavailable: ["border-dashed border-sand-line text-sand", <span key="i">?</span>],
    skipped: ["border-dashed border-line-strong text-fg-3", <Minus key="i" strokeWidth={3} />],
  } as const;
  const [cls, icon] = map[status];
  return <span className={cn("mono mt-0.5 flex size-[18px] items-center justify-center rounded-full border text-[10px] font-semibold [&_svg]:size-2.5", cls)}>{icon}</span>;
}

export function SourceTag({ source }: { source: CheckT["source"] }) {
  return <span className="mono whitespace-nowrap rounded border border-line bg-raised px-1 text-[10px] text-fg-3" title={sourceLabel(source)}>{source}</span>;
}

function Legend({ color, children, dot, dashed }: { color: string; children: string; dot?: boolean; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {dot ? <span className="size-2 rounded-full" style={{ background: color }} /> : <span className="h-0 w-3.5 border-t-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />}
      {children}
    </span>
  );
}
