import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Lock, Menu, Moon, Play, ScanSearch, SquarePlus, Sun } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { go, hrefSession, type Route } from "@/lib/router";
import { useTheme } from "@/lib/theme";
import { cn, timeAgo } from "@/lib/utils";
import { Dot, Logo } from "@/components/common";
import { Tip } from "@/components/ui/tooltip";

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[244px] shrink-0 border-r border-line bg-panel lg:flex lg:flex-col">
        <Sidebar route={route} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal aria-label="Navigation">
          <button className="absolute inset-0 bg-black/50" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-[264px] flex-col border-r border-line bg-panel" onClick={() => setOpen(false)}>
            <Sidebar route={route} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header route={route} onMenu={() => setOpen(true)} />
        <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ route }: { route: Route }) {
  const qc = useQueryClient();
  const { theme, toggle } = useTheme();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: 60_000 });
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions,
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === "queued" || s.status === "running") ? 1000 : 8000),
  });
  const run = useMutation({
    mutationFn: api.runFixture,
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      go(hrefSession(id));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const demos = config.data?.fixtures.filter((f) => f.demo) ?? [];
  const activeId = route.name === "session" ? route.id : undefined;

  return (
    <>
      <div className="flex h-14 items-center px-4">
        <a href="#/" className="rounded-md" aria-label="opscope home">
          <Logo />
        </a>
      </div>
      <nav className="px-2.5" aria-label="Primary">
        <NavItem href="#/" active={route.name === "home" || route.name === "session"} icon={<ScanSearch />}>
          Inspector
        </NavItem>
        <NavItem href="#/new" active={route.name === "new"} icon={<SquarePlus />}>
          New Operation
        </NavItem>
      </nav>

      <div className="mt-6 px-4">
        <div className="eyebrow flex items-center gap-2">
          <FlaskConical className="size-3" /> Demo fixtures
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-fg-3">Executable scenarios on a fresh local Anvil chain. Labelled demo data.</p>
      </div>
      <ul className="mt-2 space-y-0.5 px-2.5">
        {demos.map((f) => (
          <li key={f.id}>
            <button
              onClick={() => run.mutate(f.id)}
              disabled={run.isPending}
              className="group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-raised disabled:opacity-60"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-line-strong text-fg-3 transition-colors group-hover:border-lav-line group-hover:text-lav">
                <Play className="size-3" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-fg-2 group-hover:text-fg">{f.title}</span>
                <span className="mono block text-[10.5px] text-fg-3">{f.expectedCode}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-between px-4">
        <span className="eyebrow">Recent sessions</span>
        <span className="mono text-[10.5px] text-fg-3">{sessions.data?.length ?? 0}</span>
      </div>
      <ul className="scrollbar-thin mt-1.5 min-h-0 flex-1 space-y-px overflow-y-auto px-2.5 pb-3">
        {sessions.data?.map((s) => {
          const tone = s.status === "error" ? "warn" : s.status !== "done" ? "lav" : s.verdict === "failed" ? "fail" : s.verdict === "passed" ? "pass" : "warn";
          return (
            <li key={s.id}>
              <a
                href={hrefSession(s.id)}
                aria-current={activeId === s.id ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-raised",
                  activeId === s.id && "bg-lav-soft before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded before:bg-lav",
                )}
              >
                <Dot tone={tone} pulse={s.status === "running" || s.status === "queued"} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("mono truncate text-[12px]", tone === "fail" ? "text-rose" : tone === "pass" ? "text-lime" : "text-fg-2")}>{s.code ?? (s.status === "error" ? "ERROR" : s.status)}</span>
                    <span className="mono shrink-0 text-[10.5px] text-fg-3">{timeAgo(s.createdAt)}</span>
                  </span>
                  <span className="block truncate text-[12px] text-fg-3">
                    {s.demo && <span className="text-sand">demo · </span>}
                    {s.label}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
        {sessions.data?.length === 0 && <li className="px-2 py-2 text-[12px] text-fg-3">No sessions yet. Run a demo fixture or import an operation.</li>}
      </ul>

      <div className="flex items-center justify-between border-t border-line px-3 py-2.5">
        <Tip content="API binds 127.0.0.1 and refuses other hosts and cross-site origins. RPC URLs stay on the server.">
          <span className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
            <Lock className="size-3" /> localhost only
          </span>
        </Tip>
        <button onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-3 hover:bg-raised hover:text-fg">
          {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>
      </div>
    </>
  );
}

function NavItem({ href, active, icon, children }: { href: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors [&_svg]:size-4", active ? "bg-raised text-fg [&_svg]:text-lav" : "text-fg-2 hover:bg-raised hover:text-fg")}
    >
      {icon}
      {children}
    </a>
  );
}

function Header({ route, onMenu }: { route: Route; onMenu: () => void }) {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 5000, retry: false });
  const h = health.data;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur lg:px-6">
      <button className="flex size-8 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-raised lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu className="size-4" />
      </button>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className="text-fg-3">workspace</span>
        <span className="text-fg-3">/</span>
        <a href="#/" className={cn("hover:text-fg", route.name === "home" ? "text-fg" : "text-fg-3")}>
          {route.name === "new" ? "operations" : "sessions"}
        </a>
        {route.name !== "home" && (
          <>
            <span className="text-fg-3">/</span>
            <span className="mono truncate text-[12.5px] text-fg">{route.name === "session" ? route.id : "new"}</span>
          </>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        {health.isError ? (
          <Pill tone="fail" label="API offline" detail="Start it with pnpm dev or opscope serve." />
        ) : (
          <>
            <Pill tone={h ? "pass" : "idle"} label="API" value={h ? `v${h.version}` : "…"} detail={h ? `Sessions in ${h.store}` : undefined} />
            <Pill
              tone={h?.anvil.available ? "pass" : h ? "fail" : "idle"}
              label="anvil"
              value={h?.anvil.version?.replace(/-.*/, "") ?? (h ? "missing" : "…")}
              detail={h?.anvil.available ? `Replays run in isolated Anvil processes · ${h.queue.max} at a time · ${Math.round(h.queue.timeoutMs / 1000)} s timeout` : "Install Foundry to enable local replay."}
              className="hidden sm:inline-flex"
            />
            <Pill
              tone={h ? (h.config.usable ? "pass" : "warn") : "idle"}
              label="rpc"
              value={h ? `${h.config.usable}/${h.config.connections}` : "…"}
              detail="Server-side RPC connections with credentials available. URLs never reach the browser."
              className="hidden md:inline-flex"
            />
            {h && h.queue.running > 0 && <Pill tone="lav" label="running" value={String(h.queue.running)} pulse />}
          </>
        )}
      </div>
    </header>
  );
}

function Pill({ tone, label, value, detail, pulse, className }: { tone: "pass" | "fail" | "warn" | "idle" | "lav"; label: string; value?: string; detail?: string; pulse?: boolean; className?: string }) {
  return (
    <Tip content={detail}>
      <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-panel px-2 text-[11.5px]", className)}>
        <Dot tone={tone} pulse={pulse} />
        <span className="text-fg-3">{label}</span>
        {value && <span className="mono text-fg-2">{value}</span>}
      </span>
    </Tip>
  );
}
