import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { Hex } from "viem";

const pexec = promisify(execFile);

export interface AnvilOptions {
  anvilPath?: string;
  forkUrl?: string;
  forkBlockNumber?: bigint;
  /** fork from the state *after* this transaction (anvil --fork-transaction-hash) */
  forkTransactionHash?: Hex;
  chainId?: number;
  timestamp?: number;
  baseFee?: bigint;
  accounts?: number;
  /** fixed port; default 0 = any free port */
  port?: number;
  startupTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface AnvilHandle {
  url: string;
  port: number;
  pid: number;
  args: string[];
  stop(): Promise<void>;
}

export class AnvilNotFoundError extends Error {
  constructor(path: string) {
    super(`anvil (Foundry) not found at "${path}". Install Foundry (https://getfoundry.sh) or set replay.anvilPath.`);
    this.name = "AnvilNotFoundError";
  }
}

const live = new Set<ChildProcess>();

/** Kills every Anvil this process started. Called on shutdown and by job timeouts. */
export function killAllAnvils() {
  for (const c of live) c.kill("SIGKILL");
  live.clear();
}
process.once("exit", killAllAnvils);

let cachedVersion: Promise<string | undefined> | undefined;
export function anvilVersion(anvilPath = "anvil"): Promise<string | undefined> {
  cachedVersion ??= pexec(anvilPath, ["--version"], { timeout: 5000 })
    .then(({ stdout }) => /anvil Version: (\S+)/.exec(stdout)?.[1] ?? stdout.split("\n")[0]?.trim())
    .catch(() => undefined);
  return cachedVersion;
}

/**
 * Starts an isolated Anvil bound to 127.0.0.1 on a free port (anvil --port 0) and
 * resolves once it prints its listen address. Each replay job gets its own process.
 */
export async function startAnvil(opts: AnvilOptions = {}): Promise<AnvilHandle> {
  const anvilPath = opts.anvilPath ?? "anvil";
  const args = ["--host", "127.0.0.1", "--port", String(opts.port ?? 0), "--accounts", String(opts.accounts ?? 4), "--balance", "10000"];
  if (opts.forkUrl) {
    args.push("--fork-url", opts.forkUrl, "--no-storage-caching", "--retries", "2", "--timeout", "20000");
    if (opts.forkTransactionHash) args.push("--fork-transaction-hash", opts.forkTransactionHash);
    else if (opts.forkBlockNumber !== undefined) args.push("--fork-block-number", opts.forkBlockNumber.toString());
  }
  if (opts.chainId !== undefined) args.push("--chain-id", String(opts.chainId));
  if (opts.timestamp !== undefined) args.push("--timestamp", String(opts.timestamp));
  if (opts.baseFee !== undefined) args.push("--block-base-fee-per-gas", opts.baseFee.toString());

  let child: ChildProcess;
  try {
    child = spawn(anvilPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new AnvilNotFoundError(anvilPath);
  }
  live.add(child);

  let out = "";
  const stop = async () => {
    live.delete(child);
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      child.kill("SIGTERM");
    });
  };

  const ready = new Promise<{ port: number }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`anvil did not start within ${opts.startupTimeoutMs ?? 30000} ms. ${tail(out)}`)), opts.startupTimeoutMs ?? 30000);
    const onData = (buf: Buffer) => {
      out += buf.toString();
      const m = /Listening on [^:\s]+:(\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ port: Number(m[1]) });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new AnvilNotFoundError(anvilPath) : e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`anvil exited with code ${code} before it was ready. ${tail(out)}`));
    });
    opts.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });

  try {
    const { port } = await ready;
    // stop buffering logs once ready; anvil can be chatty
    child.stdout?.removeAllListeners("data");
    child.stderr?.removeAllListeners("data");
    child.stdout?.resume();
    child.stderr?.resume();
    opts.signal?.addEventListener("abort", () => void stop());
    return { url: `http://127.0.0.1:${port}`, port, pid: child.pid ?? -1, args: redactArgs(args), stop };
  } catch (e) {
    await stop();
    throw e;
  }
}

function tail(s: string) {
  const lines = s.trim().split("\n").filter((l) => /error|Error|failed/.test(l));
  return (lines.length ? lines : s.trim().split("\n")).slice(-3).join(" | ").slice(0, 600);
}

/** fork URLs carry credentials; keep only the host in anything we record */
function redactArgs(args: string[]) {
  return args.map((a, i) => {
    if (args[i - 1] !== "--fork-url") return a;
    try {
      return `${new URL(a).protocol}//${new URL(a).host}/…`;
    } catch {
      return "[redacted]";
    }
  });
}
