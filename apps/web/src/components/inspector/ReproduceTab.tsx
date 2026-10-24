import { Download, FileJson, FileText, GitCompareArrows, Terminal } from "lucide-react";
import { chainName, gasNum, gwei, short, type Evidence } from "@opscope/core";
import { reproduceCommand, type Session } from "@opscope/diagnosis";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Addr, CopyButton, KV, Section } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const EXACTNESS = {
  exact: { tone: "lime", text: "The original bundle transaction was re-executed from its exact pre-transaction state, with the original block environment, and its receipt matched the on-chain one." },
  pinned: { tone: "lav", text: "Executed against the pinned block's state as the only transaction of a hypothetical next block. Deterministic and re-runnable; real inclusion ordering can differ." },
  approximate: { tone: "sand", text: "A known fidelity gap applies (listed below). Treat the result as an approximation." },
  "not-run": { tone: "neutral", text: "No local replay ran; only preflight reads and simulations are recorded." },
} as const;

export function ReproduceTab({ s, e }: { s: Session; e: Evidence }) {
  const c = e.context;
  const r = c.replay;
  const ex = EXACTNESS[r.exactness];
  const cmd = reproduceCommand(s.id);
  const files = ["diagnosis.md", "userop.json", "replay.config.json", "evidence.json", ...(e.replay.trace.status === "ok" ? ["trace.json"] : []), "REPRODUCE.md", "manifest.json"];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="min-w-0 space-y-4">
        <div className={cn("panel flex items-start gap-3 p-4", ex.tone === "lime" && "border-lime-line", ex.tone === "sand" && "border-sand-line")}>
          <Badge tone={ex.tone} className="mt-0.5 h-6 px-2 text-[11.5px]">
            {r.exactness}
          </Badge>
          <p className="text-[13px] leading-relaxed text-fg-2">{ex.text}</p>
        </div>

        <div className="panel px-4 py-2">
          <h3 className="eyebrow py-2">Pinned context</h3>
          <dl>
            <KV k="Chain">
              {c.chain.id} · {chainName(c.chain.id)}
              {s.demo && <Badge tone="demo" className="ml-2">demo fixture</Badge>}
            </KV>
            <KV k="Block">
              <span className="mono text-[12.5px]">#{c.block.number}</span>
              <span className="mono ml-2 break-all text-[12px] text-fg-3">{c.block.hash}</span>
              <div className="text-[12px] text-fg-3">
                pinned by {c.block.pinnedBy}
                {c.block.timestamp !== "—" && ` · t=${c.block.timestamp}`}
                {c.block.baseFeePerGas && ` · base fee ${gwei(c.block.baseFeePerGas)}`}
              </div>
            </KV>
            <KV k="EntryPoint">
              <Addr address={c.entryPoint.address} label={`v${c.entryPoint.version}`} />
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-fg-3">
                {c.entryPoint.canonical ? <Badge tone="lime">canonical codehash</Badge> : <Badge tone="sand">unverified code</Badge>}
                <span className="mono">{short(c.entryPoint.codeHash, 10, 6)}</span>
              </div>
            </KV>
            <KV k="Account">
              <Addr address={c.account.address} label={c.account.implementation?.label ?? (c.account.deployed ? "unknown implementation" : "not deployed")} />
              {c.account.implementation?.codeHash && <div className="mono text-[11.5px] text-fg-3">impl codehash {short(c.account.implementation.codeHash, 10, 6)}</div>}
            </KV>
            {c.paymaster && (
              <KV k="Paymaster">
                <Addr address={c.paymaster.address} label={c.paymaster.label ?? (c.paymaster.deployed ? "deployed" : "no code")} />
              </KV>
            )}
            <KV k="Connection">
              <span className="mono text-[12.5px]">{c.connection.id}</span> <span className="text-fg-3">· {c.connection.host}</span>
              <div className="text-[11.5px] text-fg-3">RPC credentials stay on the server and are redacted from every export.</div>
            </KV>
            {c.inclusion && (
              <KV k="Inclusion">
                <span className="mono text-[12px]">{short(c.inclusion.txHash, 12, 8)}</span>
                <span className="text-fg-3"> · index {c.inclusion.txIndex} in block {c.inclusion.blockNumber}</span>
                {c.inclusion.precedingTx && <div className="text-[12px] text-fg-3">preceded by {short(c.inclusion.precedingTx, 10, 6)}</div>}
              </KV>
            )}
            <KV k="Fork point">
              <span className="mono text-[12.5px]">{r.mode}</span>
              <span className="text-fg-3">
                {r.forkAfterTx ? ` · state after ${short(r.forkAfterTx, 10, 6)}` : r.forkBlock ? ` · state after block ${r.forkBlock}` : ""}
                {r.precedingTxs > 0 && ` · ${r.precedingTxs} preceding tx applied`}
              </span>
            </KV>
            <KV k="Tools">
              <span className="mono text-[12px]">
                opscope {c.tools.opscope} · anvil {c.tools.anvil ?? "n/a"} · node {c.tools.node}
              </span>
            </KV>
          </dl>
        </div>

        {e.replay.comparison && (
          <div className={cn("panel p-4", e.replay.comparison.identical ? "border-lime-line" : "border-sand-line")}>
            <Section title={<span className="flex items-center gap-1.5"><GitCompareArrows className="size-3.5" /> Replay vs original receipt</span>} aside={<Badge tone={e.replay.comparison.identical ? "lime" : "sand"}>{e.replay.comparison.identical ? "identical" : "differs"}</Badge>}>
              <ul className="space-y-1 text-[12.5px] text-fg-2">
                {e.replay.comparison.details.map((x) => (
                  <li key={x}>· {x}</li>
                ))}
              </ul>
            </Section>
          </div>
        )}

        <div className="panel p-4">
          <Section title="Recorded overrides">
            <ul className="space-y-2 text-[12.5px]">
              {r.stateOverrides.map((o, i) => (
                <li key={i} className="grid grid-cols-[86px_1fr] gap-2">
                  <span className="mono text-[11px] uppercase text-lav">{o.kind}</span>
                  <span className="text-fg-2">
                    <span className="mono text-[11.5px] text-fg-3">{short(o.address)}</span> · {o.detail}. <span className="text-fg-3">{o.purpose} ({o.scope})</span>
                  </span>
                </li>
              ))}
              {r.blockEnv.map((b, i) => (
                <li key={`b${i}`} className="grid grid-cols-[86px_1fr] gap-2">
                  <span className="mono text-[11px] uppercase text-sand">block.{b.field}</span>
                  <span className="text-fg-2">
                    <span className="mono text-[11.5px]">{b.value}</span> · <span className="text-fg-3">{b.reason}</span>
                  </span>
                </li>
              ))}
              {r.handleOps && (
                <li className="grid grid-cols-[86px_1fr] gap-2">
                  <span className="mono text-[11px] uppercase text-fg-3">handleOps</span>
                  <span className="text-fg-2">
                    from <span className="mono text-[11.5px]">{short(r.handleOps.from)}</span> · gas {gasNum(r.handleOps.gasLimit)}. <span className="text-fg-3">{r.handleOps.note}</span>
                  </span>
                </li>
              )}
            </ul>
          </Section>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="panel p-4">
          <Section title="Reproduction command">
            <div className="flex items-center gap-2 rounded-md border border-lav-line bg-sunken px-3 py-2.5">
              <Terminal className="size-4 shrink-0 text-lav" />
              <code className="min-w-0 flex-1 truncate text-[13px] text-fg">{cmd}</code>
              <CopyButton value={cmd} label="Copy command" />
            </div>
            <p className="mt-2 text-[12px] leading-snug text-fg-3">
              {s.request.connection.kind === "fixture"
                ? "Rebuilds the deterministic fixture chain locally, checks the pinned block hash, re-runs and compares."
                : `Needs a connection named "${s.request.connection.kind === "rpc" ? s.request.connection.id : ""}" in your own config. Checks the pinned block hash before replaying.`}
            </p>
            <Button asChild variant="primary" className="mt-3 w-full">
              <a href={api.bundleUrl(s.id)} download>
                <Download /> Export bundle (.zip)
              </a>
            </Button>
          </Section>
        </div>
        <div className="panel p-4">
          <Section title="Bundle contents">
            <ul className="space-y-1.5">
              {files.map((f) => (
                <li key={f} className="flex items-center gap-2 text-[12.5px]">
                  {f.endsWith(".md") ? <FileText className="size-3.5 text-fg-3" /> : <FileJson className="size-3.5 text-fg-3" />}
                  <span className="mono text-fg-2">{f}</span>
                  <span className="ml-auto text-[11.5px] text-fg-3">{FILE_NOTE[f]}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
        {r.approximations.length > 0 && (
          <div className="panel p-4">
            <Section title="Approximations">
              <ul className="space-y-1.5 text-[12.5px] text-fg-2">
                {r.approximations.map((a) => (
                  <li key={a}>~ {a}</li>
                ))}
              </ul>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

const FILE_NOTE: Record<string, string> = {
  "diagnosis.md": "report",
  "userop.json": "operation + hash",
  "replay.config.json": "pins + expected result",
  "evidence.json": "everything observed",
  "trace.json": "call tree",
  "REPRODUCE.md": "how to re-run",
  "manifest.json": "sha256 per file",
};
