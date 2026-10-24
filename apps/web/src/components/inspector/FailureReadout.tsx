import { motion } from "motion/react";
import { Boxes, CircleCheck, Cpu, FileCode2, HandCoins, Package, Server, Settings2, ShieldCheck, ShieldQuestion, Wallet } from "lucide-react";
import type { Component } from "@opscope/core";
import type { Diagnosis } from "@opscope/diagnosis";
import { cn } from "@/lib/utils";
import { Addr } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";

const COMPONENT: Record<Component, { label: string; icon: typeof Wallet }> = {
  account: { label: "Smart account", icon: Wallet },
  paymaster: { label: "Sponsor (paymaster)", icon: HandCoins },
  factory: { label: "Account factory", icon: Boxes },
  target: { label: "Application contract", icon: FileCode2 },
  rpc: { label: "RPC connection", icon: Server },
  config: { label: "Configuration", icon: Settings2 },
  bundler: { label: "Bundler", icon: Package },
  entrypoint: { label: "EntryPoint", icon: Cpu },
  userop: { label: "Operation fields", icon: FileCode2 },
  unknown: { label: "Not established", icon: ShieldQuestion },
};

const TONE_BOX = { rose: "border-rose-line bg-rose-soft text-rose", lime: "border-lime-line bg-lime-soft text-lime", sand: "border-sand-line bg-sand-soft text-sand" } as const;

export function FailureReadout({ d }: { d: Diagnosis }) {
  const tone = d.verdict === "failed" ? "rose" : d.verdict === "passed" ? "lime" : "sand";
  const comp = COMPONENT[d.responsible.component];
  const stageLabel = d.lifecycle.find((s) => s.id === d.stage)?.label ?? d.stage;
  const codeColor = tone === "rose" ? "text-rose" : tone === "lime" ? "text-lime" : "text-sand";

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn("panel relative overflow-hidden", tone === "rose" && "border-rose-line", tone === "sand" && "border-sand-line", tone === "lime" && "border-lime-line")}
      aria-label="Failure summary"
    >
      <div className={cn("absolute inset-x-0 top-0 h-px", tone === "rose" ? "bg-rose" : tone === "lime" ? "bg-lime" : "bg-sand")} />
      <div className="grid gap-0 lg:grid-cols-[minmax(200px,250px)_1fr_minmax(250px,300px)]">
        <div className="flex flex-col justify-between gap-4 border-b border-line p-5 lg:border-r lg:border-b-0">
          <div>
            <div className="eyebrow">{d.verdict === "passed" ? "Result" : d.verdict === "inconclusive" ? "Could not evaluate" : "Error code"}</div>
            <div className={cn("mono mt-1.5 font-semibold", codeColor, d.code.length > 8 ? "text-[24px] leading-[1.15] tracking-[-0.02em]" : "text-[46px] leading-[1] tracking-[-0.04em]")}>{d.code.replace(/_/g, "_\u200b")}</div>
          </div>
          <div className="space-y-2">
            <Tip content={d.corroboration.length ? <ul className="space-y-1">{d.corroboration.map((c) => <li key={c}>✓ {c}</li>)}</ul> : "Single source"}>
              <div className="flex cursor-default items-center gap-1.5 text-[12px] text-fg-2">
                <ShieldCheck className={cn("size-3.5", d.confidence === "high" ? "text-lime" : d.confidence === "medium" ? "text-sand" : "text-fg-3")} />
                <span>
                  Confidence <span className="text-fg">{d.confidence}</span>
                  {d.corroboration.length > 0 && <span className="text-fg-3"> · {d.corroboration.length} sources agree</span>}
                </span>
              </div>
            </Tip>
            <div className="mono line-clamp-3 break-words text-[11px] leading-snug text-fg-3" title={d.reason.text}>
              {d.reason.text}
            </div>
          </div>
        </div>

        <div className="border-b border-line p-5 lg:border-b-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{d.verdict === "failed" ? `failed at · ${stageLabel}` : d.verdict === "passed" ? "no failure reproduced" : "inconclusive"}</Badge>
            {d.reason.decoded?.name && d.reason.decoded.kind !== "FailedOp" && <Badge tone="neutral">{d.reason.decoded.name}</Badge>}
          </div>
          <h2 className="mt-3 text-[25px] font-bold leading-tight text-fg">{d.title}</h2>
          <p className="mt-2 max-w-[68ch] text-[14.5px] leading-relaxed text-fg-2">{d.summary}</p>
        </div>

        <div className="p-5 lg:border-l lg:border-line">
          <div className="eyebrow">Responsible component</div>
          <div className="mt-3 flex items-start gap-3">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[10px] border", d.responsible.established ? TONE_BOX[tone] : "border-dashed border-line-strong text-fg-3")}>
              <comp.icon className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <div className="text-[12px] text-fg-3">{comp.label}</div>
              <div className="truncate font-display text-[15px] font-semibold text-fg">{d.responsible.label}</div>
              {d.responsible.address && <Addr address={d.responsible.address} className="mt-0.5" />}
            </div>
          </div>
          <div className="mt-3 flex items-start gap-1.5 text-[12px] leading-snug text-fg-2">
            {d.responsible.established ? <CircleCheck className="mt-px size-3.5 shrink-0 text-lime" /> : <ShieldQuestion className="mt-px size-3.5 shrink-0 text-sand" />}
            <span>
              <span className={d.responsible.established ? "text-lime" : "text-sand"}>{d.responsible.established ? "Established" : "Not established"}</span> — {d.responsible.basis}
            </span>
          </div>
        </div>
      </div>

      {d.metrics.length > 0 && (
        <div className="grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {d.metrics.map((m, i) => (
            <motion.div key={m.label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + i * 0.06 }} className="border-line px-5 py-3 [&:not(:last-child)]:border-r">
              <div className="eyebrow">{m.label}</div>
              <div className={cn("mono mt-1 truncate text-[17px] font-medium", m.tone === "fail" ? "text-rose" : m.tone === "pass" ? "text-lime" : "text-fg")}>{m.value}</div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.section>
  );
}
