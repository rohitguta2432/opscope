import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Activity, Download, FileUp, Layers, ListTree, Play, RotateCcw, SquarePlus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { unzipSync, strFromU8 } from "fflate";
import { chainName, short } from "@opscope/core";
import type { Session } from "@opscope/diagnosis";
import { api } from "@/lib/api";
import { go, hrefSession } from "@/lib/router";
import { setPrefill } from "@/lib/prefill";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { FailureReadout } from "@/components/inspector/FailureReadout";
import { LifecycleScope } from "@/components/inspector/LifecycleScope";
import { TraceTab } from "@/components/inspector/TraceTab";
import { OperationTab } from "@/components/inspector/OperationTab";
import { ReproduceTab } from "@/components/inspector/ReproduceTab";

export function InspectorPage({ id }: { id?: string }) {
  const q = useQuery({
    queryKey: ["session", id],
    queryFn: () => api.session(id!),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data && (query.state.data.status === "queued" || query.state.data.status === "running") ? 350 : false),
  });
  const s = q.data;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 lg:px-7 lg:py-6">
      <Toolbar s={s} />
      {!id && <Empty />}
      {id && q.isLoading && <div className="mt-10 text-[13px] text-fg-3">Loading session…</div>}
      {id && q.isError && <div className="mt-10 text-[13px] text-rose">{(q.error as Error).message}</div>}
      {s && (s.status === "queued" || s.status === "running") && <Running s={s} />}
      {s?.status === "error" && <Failed s={s} />}
      {s?.status === "done" && s.diagnosis && s.evidence && <Result s={s} />}
    </div>
  );
}

function Toolbar({ s }: { s?: Session }) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const replay = useMutation({
    mutationFn: () => api.replay(s!.id),
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      go(hrefSession(id));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const onFile = async (f: File) => {
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      if (f.name.endsWith(".zip")) {
        const files = unzipSync(buf);
        const get = (n: string) => Object.entries(files).find(([k]) => k.endsWith(`/${n}`) || k === n)?.[1];
        const rc = get("replay.config.json");
        const uo = get("userop.json");
        if (!rc || !uo) throw new Error("Not an OpScope bundle: replay.config.json / userop.json missing");
        const cfg = JSON.parse(strFromU8(rc));
        const op = JSON.parse(strFromU8(uo));
        const { id } = await api.start({ userOp: op.userOperation, chainId: cfg.chainId, entryPoint: cfg.entryPoint, connection: cfg.connection, block: cfg.block, mode: cfg.mode, label: `Imported ${cfg.sessionId}` });
        toast.success(`Replaying bundle ${cfg.sessionId} at block ${cfg.pins.blockNumber}`);
        void qc.invalidateQueries({ queryKey: ["sessions"] });
        go(hrefSession(id));
        return;
      }
      const text = new TextDecoder().decode(buf);
      const parsed = JSON.parse(text);
      setPrefill({ json: JSON.stringify(parsed, null, 2), chainId: parsed.chainId, entryPoint: parsed.entryPoint, source: f.name });
      go("#/new");
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <h1 className="font-display text-[15px] font-semibold text-fg-2">Operation inspector</h1>
      </div>
      <div className="flex items-center gap-2">
        <input ref={file} type="file" accept=".json,.zip,application/json,application/zip" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        <Tip content="Import a userop.json into the editor, or a bundle .zip to replay it at its pinned block">
          <Button variant="outline" onClick={() => file.current?.click()}>
            <FileUp /> Import
          </Button>
        </Tip>
        <Tip content={s?.evidence ? `Re-run pinned to block ${s.evidence.context.block.number}` : "Open a session to replay it"}>
          <Button variant="outline" disabled={!s?.evidence || replay.isPending} onClick={() => replay.mutate()}>
            <RotateCcw className={cn(replay.isPending && "animate-spin")} /> Replay
          </Button>
        </Tip>
        <Button asChild variant="primary" className={cn(!s?.evidence && "pointer-events-none opacity-45")}>
          <a href={s?.evidence ? api.bundleUrl(s.id) : undefined} download aria-disabled={!s?.evidence}>
            <Download /> Export
          </a>
        </Button>
      </div>
    </div>
  );
}

function Result({ s }: { s: Session }) {
  const d = s.diagnosis!;
  const e = s.evidence!;
  const c = e.context;
  return (
    <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-[21px] font-bold text-fg">{s.label}</h2>
            {s.demo && (
              <Tip content={`Generated by the executable fixture "${c.fixture?.id}" v${c.fixture?.version} on a fresh local Anvil chain. Not a live-network result.`}>
                <span>
                  <Badge tone="demo">demo · {c.fixture?.id}</Badge>
                </span>
              </Tip>
            )}
            {s.replayOf && <Badge tone="lav">replay of {s.replayOf}</Badge>}
          </div>
          <div className="mono mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
            <span>
              chain <span className="text-fg-2">{c.chain.id}</span> {chainName(c.chain.id)}
            </span>
            <span>
              block <span className="text-fg-2">#{c.block.number}</span> {short(c.block.hash, 8, 4)}
            </span>
            <span>
              EntryPoint <span className="text-fg-2">v{c.entryPoint.version}</span>
              {c.entryPoint.canonical && <span className="text-lime"> ✓</span>}
            </span>
            <span>
              replay <span className={c.replay.exactness === "exact" ? "text-lime" : c.replay.exactness === "approximate" ? "text-sand" : "text-lav"}>{c.replay.exactness}</span>
            </span>
            <span>{s.durationMs} ms</span>
            <span className="text-fg-2">{s.id}</span>
          </div>
        </div>
      </div>

      <FailureReadout d={d} />
      <LifecycleScope d={d} animateKey={s.id} />

      <Tabs defaultValue="trace" className="pt-1">
        <TabsList>
          <TabsTrigger value="trace">
            <ListTree /> Trace
            <span className="mono text-[10.5px] font-normal text-fg-3">{e.replay.trace.status === "ok" ? "evidence" : "n/a"}</span>
          </TabsTrigger>
          <TabsTrigger value="operation">
            <Layers /> Operation
          </TabsTrigger>
          <TabsTrigger value="reproduce">
            <Activity /> Reproduce
            <span className={cn("mono text-[10.5px] font-normal", c.replay.exactness === "exact" ? "text-lime" : "text-fg-3")}>{c.replay.exactness}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="trace" className="pt-4">
          <TraceTab e={e} d={d} />
        </TabsContent>
        <TabsContent value="operation" className="pt-4">
          <OperationTab e={e} />
        </TabsContent>
        <TabsContent value="reproduce" className="pt-4">
          <ReproduceTab s={s} e={e} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}

const PLAN = ["Building fixture chain", "Connecting to RPC", "Pinning block", "Starting isolated Anvil fork", "Reading code identities", "Running bundler preflight", "Replaying handleOps on the fork", "Diagnosing"];

function Running({ s }: { s: Session }) {
  const done = s.progress.map((p) => p.step);
  const steps = s.request.connection.kind === "fixture" ? PLAN : PLAN.slice(1);
  const current = done[done.length - 1];
  const shown = steps.map((st) => (st === "Replaying handleOps on the fork" && done.includes("Re-executing original bundle transaction") ? "Re-executing original bundle transaction" : st));
  return (
    <div className="panel overflow-hidden">
      <div className="graticule relative h-28 overflow-hidden">
        <motion.div className="absolute inset-y-0 w-[28%]" style={{ background: "linear-gradient(90deg, transparent, var(--lav-soft) 70%, var(--lav-line))" }} initial={{ left: "-30%" }} animate={{ left: "105%" }} transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }} />
        <div className="absolute inset-x-0 top-1/2 h-px bg-lav-line" />
      </div>
      <div className="grid gap-6 p-5 md:grid-cols-[1fr_320px]">
        <div>
          <div className="eyebrow">{s.status === "queued" ? "Queued" : "Inspecting"}</div>
          <h2 className="mt-1 font-display text-[20px] font-bold">{s.label}</h2>
          <p className="mt-1 text-[13px] text-fg-2">Each step below is reported by the server as it happens. Nothing is shown until the EVM has produced it.</p>
        </div>
        <ol className="space-y-1.5">
          {shown.map((st) => {
            const isDone = done.includes(st) && st !== current;
            const isCur = st === current;
            return (
              <li key={st} className={cn("flex items-center gap-2.5 text-[13px]", isDone ? "text-fg-2" : isCur ? "text-fg" : "text-fg-3")}>
                <span className={cn("flex size-4 items-center justify-center rounded-full border text-[9px]", isDone ? "border-lime-line bg-lime-soft text-lime" : isCur ? "border-lav text-lav" : "border-line-strong")}>{isDone ? "✓" : isCur ? <span className="size-1.5 animate-pulse rounded-full bg-lav" /> : ""}</span>
                {st}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Failed({ s }: { s: Session }) {
  return (
    <div className="panel border-sand-line p-6">
      <div className="flex items-center gap-2 text-sand">
        <TriangleAlert className="size-4" />
        <span className="eyebrow text-sand">Inspection did not complete</span>
      </div>
      <p className="mono mt-3 break-words text-[13px] text-fg">{s.error}</p>
      <p className="mt-2 text-[12.5px] text-fg-3">No result is shown because none was produced. Check the inputs or the server log, then retry.</p>
    </div>
  );
}

function Empty() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const run = useMutation({
    mutationFn: api.runFixture,
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      go(hrefSession(id));
    },
  });
  return (
    <div className="panel overflow-hidden">
      <div className="graticule relative flex h-40 items-center justify-center">
        <svg viewBox="0 0 600 120" className="h-24 w-full max-w-[640px]" aria-hidden>
          <path d="M0 64 H150 L162 64 L168 70 L174 26 L182 82 L188 64 H300 L312 64 L318 70 L324 26 L332 82 L338 64 H420 L428 64 L433 72 L438 14 L444 98 L450 34 L456 86 L462 50 L468 72 L474 58 L480 66 L486 63" fill="none" stroke="var(--lav)" strokeWidth="2" strokeLinejoin="round" />
          <path d="M490 64 H600" stroke="var(--fg-3)" strokeDasharray="5 6" strokeWidth="1.4" />
          <circle cx="440" cy="40" r="5" fill="var(--rose)" />
        </svg>
      </div>
      <div className="grid gap-8 p-6 md:grid-cols-[1.2fr_1fr]">
        <div>
          <Logo />
          <h2 className="mt-4 text-[26px] font-bold leading-tight">Find where a UserOperation failed, and prove it.</h2>
          <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-fg-2">
            OpScope pins the chain state, runs the bundler-style preflight, replays handleOps on an isolated Anvil fork and shows the trace, the evidence and what to check next. EntryPoint v0.7, SimpleAccount v0.7.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" size="lg" onClick={() => go("#/new")}>
              <SquarePlus /> New operation
            </Button>
          </div>
        </div>
        <div>
          <div className="eyebrow mb-2">Or run an executable demo</div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {config.data?.fixtures
              .filter((f) => f.demo)
              .map((f) => (
                <li key={f.id}>
                  <button onClick={() => run.mutate(f.id)} className="group flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left hover:bg-raised">
                    <Play className="size-3.5 text-fg-3 group-hover:text-lav" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] text-fg">{f.title}</span>
                      <span className="block truncate text-[12px] text-fg-3">{f.summary}</span>
                    </span>
                    <span className="mono text-[11px] text-fg-3">{f.expectedCode}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
