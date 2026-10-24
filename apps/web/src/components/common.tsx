import { useState, type ReactNode } from "react";
import { Check, Copy as CopyIcon } from "lucide-react";
import { short } from "@opscope/core";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden>
        <circle cx="12" cy="12" r="10.25" fill="none" stroke="var(--lav)" strokeWidth="1.5" />
        <path d="M12 1.75v3M12 19.25v3M1.75 12h3M19.25 12h3" stroke="var(--lav)" strokeWidth="1.2" strokeLinecap="round" opacity=".55" />
        <path d="M5 13.2h3.2l1.6-4.4 2.6 7.6 1.7-5.2 1.2 2h3.7" fill="none" stroke="var(--lav)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="19" cy="13.2" r="1.35" fill="var(--rose)" />
      </svg>
      <span className="font-display text-[17px] font-bold tracking-[-0.03em] text-fg">opscope</span>
    </span>
  );
}

export function CopyButton({ value, className, label = "Copy" }: { value: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1100);
        });
      }}
      className={cn("inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-fg-3 transition-colors hover:bg-raised hover:text-fg", className)}
    >
      {done ? <Check className="size-3.5 text-lime" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
}

/** Address with its label; full value in the tooltip, copy on demand. */
export function Addr({ address, label, className, head = 6, tail = 4, copy = true }: { address?: string; label?: string; className?: string; head?: number; tail?: number; copy?: boolean }) {
  if (!address) return <span className="text-fg-3">—</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {label && <span className="truncate text-fg">{label}</span>}
      <Tip content={<span className="mono break-all text-[11.5px]">{address}</span>}>
        <span className="mono shrink-0 text-[12px] text-fg-3">{short(address, head, tail)}</span>
      </Tip>
      {copy && <CopyButton value={address} className="size-5" label={`Copy ${label ?? "address"}`} />}
    </span>
  );
}

export type Tone = "fail" | "pass" | "warn" | "idle" | "lav";
export function Dot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  const c = tone === "fail" ? "bg-rose" : tone === "pass" ? "bg-lime" : tone === "warn" ? "bg-sand" : tone === "lav" ? "bg-lav" : "bg-fg-3";
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", c)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", c)} />
    </span>
  );
}

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="eyebrow">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function KV({ k, children, mono }: { k: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(110px,170px)_1fr] items-baseline gap-3 border-b border-line py-2 last:border-0">
      <dt className="text-[12.5px] text-fg-3">{k}</dt>
      <dd className={cn("min-w-0 break-words text-[13px] text-fg", mono && "mono text-[12.5px]")}>{children}</dd>
    </div>
  );
}
