import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { getAddress, type Address, type Hex } from "viem";
import { ENTRYPOINT_V07, OPSCOPE_VERSION, chainName, parseUserOpInput, short, type InspectRequest } from "@opscope/core";
import { reproduceCommand, sourceLabel, type Diagnosis, type Session } from "@opscope/diagnosis";
import {
  FIXTURES,
  bundleFiles,
  fixtureRequest,
  inspect,
  killAllAnvils,
  loadConfig,
  readBundleDir,
  requestFromBundle,
  writeBundleDir,
  type LoadedConfig,
} from "@opscope/engine";
import { SessionService, startServer } from "@opscope/api";

const program = new Command()
  .name("opscope")
  .description("Local-first debugger for ERC-4337 v0.7 UserOperations")
  .version(OPSCOPE_VERSION)
  .option("-c, --config <path>", "opscope.config.json (default: nearest one upward)");

const cfgOf = (): LoadedConfig => loadConfig(program.opts().config);

program
  .command("inspect")
  .argument("<file>", "UserOperation JSON (v0.7 RPC or packed; bare, wrapped or eth_sendUserOperation params)")
  .description("Preflight and replay one operation, then print the diagnosis")
  .option("--connection <id>", "RPC connection id from the config")
  .option("--chain <id>", "chain id (default: from the file, else the connection)")
  .option("--entry-point <address>", "EntryPoint address", ENTRYPOINT_V07)
  .option("--block <n>", "pin to a block number (default: latest)")
  .option("--tx <hash>", "the operation was included: replay its bundle transaction from the exact pre-state")
  .option("--preflight-only", "skip the local Anvil replay")
  .option("--out <dir>", "also write a reproduction bundle to <dir>")
  .option("--json", "print the session as JSON")
  .option("--no-save", "don't store the session")
  .action(async (file: string, o) => {
    const cfg = cfgOf();
    const raw = JSON.parse(readFileSync(resolve(file), "utf8"));
    const parsed = parseUserOpInput(raw);
    if (!parsed.ok) {
      console.error(pc.red("Invalid UserOperation:"));
      for (const i of parsed.issues) console.error(`  ${pc.bold(i.path)}  ${i.message}`);
      process.exit(2);
    }
    const chainHint = o.chain ? Number(o.chain) : parsed.chainId;
    const conn = o.connection
      ? cfg.connections.find((c) => c.info.id === o.connection)
      : cfg.connections.find((c) => c.url && (chainHint === undefined || c.info.chainId === chainHint));
    if (!conn) fail(`No usable RPC connection${chainHint ? ` for chain ${chainHint}` : ""}. Add one to ${cfg.path ?? "opscope.config.json"} or pass --connection.`);
    const req: InspectRequest = {
      userOp: raw,
      chainId: chainHint ?? conn.info.chainId,
      entryPoint: getAddress(o.entryPoint !== ENTRYPOINT_V07 ? o.entryPoint : (parsed.entryPoint ?? ENTRYPOINT_V07)) as Address,
      connection: { kind: "rpc", id: conn.info.id },
      block: o.tx ? { kind: "inclusion", txHash: o.tx as Hex } : o.block ? { kind: "number", number: String(o.block) } : { kind: "latest" },
      mode: o.preflightOnly ? "preflight" : "preflight+replay",
    };
    await runAndReport(cfg, req, { json: o.json, out: o.out, save: o.save });
  });

program
  .command("replay")
  .argument("<bundle>", "bundle directory written by export / inspect --out")
  .description("Re-run a reproduction bundle at its pinned block and compare with the recorded result")
  .option("--connection <id>", "use this RPC connection instead of the one recorded")
  .option("--json", "print the comparison as JSON")
  .action(async (dir: string, o) => {
    const cfg = cfgOf();
    const b = readBundleDir(resolve(dir));
    const req = requestFromBundle(b, o.connection);
    const r = b.replay;
    if (!o.json) {
      console.log(`${pc.bold("Replaying")} ${r.sessionId}  ${pc.dim(r.label)}${r.demo ? pc.yellow("  [demo fixture]") : ""}`);
      console.log(pc.dim(`pinned: chain ${r.chainId} · block ${r.pins.blockNumber} ${short(r.pins.blockHash, 10, 6)}${r.block.kind === "inclusion" ? ` · inclusion tx ${short(r.block.txHash, 10, 6)}` : ""}`));
    }
    const out = await inspect(req, { config: cfg, progress: o.json ? undefined : (s) => console.log(pc.dim(`  · ${s}`)) });
    const d = out.diagnosis;
    const hashOk = out.evidence.context.block.hash.toLowerCase() === r.pins.blockHash.toLowerCase();
    const same = d.code === r.expected.code && d.stage === r.expected.stage && d.verdict === r.expected.verdict && out.evidence.userOpHash === r.expected.userOpHash;
    const reproduced = same && hashOk;
    if (o.json) {
      console.log(JSON.stringify({ reproduced, expected: r.expected, actual: { code: d.code, stage: d.stage, verdict: d.verdict, userOpHash: out.evidence.userOpHash }, blockHashMatches: hashOk, exactness: d.exactness }, null, 2));
    } else {
      console.log();
      console.log(`  recorded  ${r.expected.code} at ${r.expected.stage} (${r.expected.verdict})`);
      console.log(`  replayed  ${d.code} at ${d.stage} (${d.verdict})  ·  exactness ${d.exactness}`);
      console.log(`  block     ${hashOk ? pc.green("hash matches pinned") : pc.red(`hash differs: ${out.evidence.context.block.hash}`)}`);
      console.log();
      console.log(reproduced ? pc.green(pc.bold("  ✓ REPRODUCED")) : pc.red(pc.bold("  ✗ DIVERGED")));
    }
    process.exitCode = reproduced ? 0 : 1;
  });

program
  .command("export")
  .argument("<session-id>")
  .description("Write a stored session's reproduction bundle")
  .option("--out <dir>", "output directory (default: ./opscope-<session-id>)")
  .action((id: string, o) => {
    const svc = new SessionService(cfgOf());
    const s = svc.store.get(id);
    if (!s) fail(`No session ${id} in ${svc.store.path}`);
    const dir = writeBundleDir(o.out ?? `opscope-${id}`, bundleFiles(s));
    console.log(`${pc.green("✓")} bundle written to ${dir}`);
    for (const f of Object.keys(bundleFiles(s))) console.log(pc.dim(`  ${f}`));
    console.log(`\n  ${pc.bold(reproduceCommand(id))}`);
  });

const fixtures = program.command("fixtures").description("Executable failure fixtures (local Anvil chains)");
fixtures
  .command("list", { isDefault: true })
  .description("List fixtures")
  .action(() => {
    for (const f of FIXTURES) console.log(`${f.demo ? pc.magenta("demo ") : "     "}${pc.bold(f.id.padEnd(20))} ${f.expectedCode.padEnd(19)} ${pc.dim(f.summary)}`);
  });
fixtures
  .command("run")
  .argument("<id>")
  .description("Build the fixture chain, inspect its operation, print the diagnosis")
  .option("--out <dir>", "also write a reproduction bundle")
  .option("--json", "print the session as JSON")
  .action(async (id: string, o) => {
    await runAndReport(cfgOf(), fixtureRequest(id), { json: o.json, out: o.out, save: true });
  });

fixtures
  .command("chain")
  .argument("<id>")
  .description("Keep a fixture chain running on 127.0.0.1:<port> and write its operation to a file, to try the live-RPC path")
  .option("--port <port>", "port", "8545")
  .option("--out <file>", "where to write the operation JSON")
  .action(async (id: string, o) => {
    const { buildFixture } = await import("@opscope/engine");
    const { toRpcUserOp } = await import("@opscope/core");
    const env = await buildFixture(id, { port: Number(o.port), anvilPath: cfgOf().config.replay.anvilPath });
    const file = o.out ?? `fixture-${id}.userop.json`;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, JSON.stringify({ chainId: 31337, entryPoint: ENTRYPOINT_V07, userOperation: toRpcUserOp(env.userOp) }, null, 2) + "\n");
    console.log(`${pc.bold(env.info.title)} chain on ${env.anvil.url} (chain 31337)`);
    console.log(`operation written to ${file}${env.inclusionTx ? `  ·  included in ${env.inclusionTx}` : ""}`);
    console.log(pc.dim("Inspect it with the local-anvil connection, e.g.:"));
    console.log(`  opscope inspect ${file} --connection local-anvil${env.inclusionTx ? ` --tx ${env.inclusionTx}` : ""}`);
    console.log(pc.dim("Ctrl+C to stop."));
    await new Promise(() => {});
  });

program
  .command("sessions")
  .description("List stored sessions")
  .option("--limit <n>", "how many", "20")
  .action((o) => {
    const svc = new SessionService(cfgOf());
    for (const s of svc.store.list(Number(o.limit))) {
      const tone = s.verdict === "failed" ? pc.red : s.verdict === "passed" ? pc.green : pc.yellow;
      console.log(`${pc.bold(s.id)}  ${tone((s.code ?? s.status).padEnd(20))} ${s.label.padEnd(36)} ${pc.dim(`${chainName(s.chainId)} · ${s.createdAt.replace("T", " ").slice(0, 19)}`)}${s.demo ? pc.magenta(" demo") : ""}`);
    }
  });

program
  .command("serve")
  .description("Start the API and web inspector on localhost")
  .option("--host <host>", "bind address (localhost only unless OPSCOPE_ALLOW_REMOTE=1)")
  .option("--port <port>", "port")
  .action(async (o) => {
    const { url } = await startServer({ configPath: program.opts().config, host: o.host, port: o.port ? Number(o.port) : undefined });
    console.log(`${pc.bold("opscope")} ${url}`);
  });

async function runAndReport(cfg: LoadedConfig, req: InspectRequest, o: { json?: boolean; out?: string; save?: boolean }) {
  let s: Session;
  const step = o.json ? undefined : (x: string) => process.stderr.write(pc.dim(`  · ${x}\n`));
  if (o.save === false) {
    const out = await inspect(req, { config: cfg, progress: step });
    const now = new Date().toISOString();
    s = { id: "ops_unsaved", createdAt: now, updatedAt: now, label: req.label ?? "UserOperation", source: out.source, demo: out.demo, status: "done", progress: [], chainId: req.chainId, request: req, evidence: out.evidence, diagnosis: out.diagnosis, code: out.diagnosis.code, stage: out.diagnosis.stage, verdict: out.diagnosis.verdict };
  } else {
    s = await new SessionService(cfg).run(req, {}, step);
  }
  if (s.status === "error" || !s.diagnosis || !s.evidence) fail(s.error ?? "inspection failed");
  if (o.json) console.log(JSON.stringify(s, null, 2));
  else printReport(s);
  if (o.out) {
    const dir = writeBundleDir(o.out, bundleFiles(s));
    if (!o.json) console.log(`\n${pc.green("✓")} bundle ${dir}\n  ${pc.bold(`opscope replay ${o.out}`)}`);
  }
  process.exitCode = s.diagnosis.verdict === "failed" ? 1 : 0;
}

const glyph = (st: Diagnosis["lifecycle"][number]["status"]) =>
  st === "failed" ? pc.red("✗") : st === "passed" ? pc.green("✓") : st === "warning" ? pc.yellow("!") : st === "not_applicable" ? pc.dim("–") : pc.dim("·");

function printReport(s: Session) {
  const d = s.diagnosis!;
  const e = s.evidence!;
  const tone = d.verdict === "failed" ? pc.red : d.verdict === "passed" ? pc.green : pc.yellow;
  const w = Math.min(process.stdout.columns || 100, 100);
  const hr = pc.dim("─".repeat(w));
  console.log();
  if (s.demo) console.log(pc.yellow(`  DEMO · executable fixture "${e.context.fixture?.id}" on a local Anvil chain`));
  console.log(`  ${pc.bold(tone(d.code))}  ${pc.bold(d.title)}   ${tone(d.verdict.toUpperCase())} ${pc.dim(`· confidence ${d.confidence} · ${d.exactness}`)}`);
  console.log(hr);
  console.log(wrap(d.summary, w - 2, "  "));
  console.log();
  console.log(`  ${pc.dim("responsible")}  ${pc.bold(d.responsible.label)}${d.responsible.address ? pc.dim(` ${d.responsible.address}`) : ""}  ${d.responsible.established ? pc.green("established") : pc.yellow("not established")}`);
  console.log(`  ${pc.dim("reason     ")}  ${d.reason.text}`);
  console.log(`  ${pc.dim("lifecycle  ")}  ${d.lifecycle.map((l) => `${glyph(l.status)} ${l.label}`).join(pc.dim("  ──  "))}`);
  if (d.metrics.length) console.log(`  ${pc.dim("values     ")}  ${d.metrics.map((m) => `${pc.dim(m.label)} ${m.tone === "fail" ? pc.red(m.value) : m.value}`).join(pc.dim("  ·  "))}`);
  section("Observed");
  for (const ob of d.observations) console.log(wrap(`• ${ob.text} ${pc.dim(`(${sourceLabel(ob.source)})`)}`, w - 4, "    "));
  if (d.corroboration.length) for (const c of d.corroboration) console.log(wrap(`${pc.green("✓")} ${c}`, w - 4, "    "));
  section("Inferred");
  for (const i of d.inferences) console.log(wrap(`${pc.magenta("◆")} ${i.text} ${pc.dim(`(${i.confidence})`)}`, w - 4, "    "));
  section("Next steps");
  d.checks.forEach((c, i) => {
    console.log(wrap(`${i + 1}. ${pc.bold(c.title)} — ${c.detail}`, w - 4, "    "));
    if (c.command) console.log(`       ${pc.cyan(c.command)}`);
  });
  section("Unknowns & limitations");
  for (const u of d.unknowns) console.log(wrap(`? ${u}`, w - 4, "    "));
  for (const l of d.limitations) console.log(pc.dim(wrap(`– ${l}`, w - 4, "    ")));
  const c = e.context;
  console.log(hr);
  console.log(pc.dim(`  chain ${c.chain.id} · block ${c.block.number} ${short(c.block.hash, 10, 6)} · EntryPoint ${c.entryPoint.version}${c.entryPoint.canonical ? " canonical" : ""} · anvil ${c.tools.anvil ?? "n/a"} · ${c.replay.mode}`));
  if (s.id !== "ops_unsaved") console.log(`  session ${pc.bold(s.id)}  ${pc.dim("→")}  opscope export ${s.id}`);
}

function section(t: string) {
  console.log();
  console.log(`  ${pc.bold(t)}`);
}

function wrap(text: string, width: number, indent: string) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  // eslint-disable-next-line no-control-regex
  const vis = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  for (const word of words) {
    if (vis(line) + vis(word) + 1 > width && line) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join("\n");
}

function fail(msg: string): never {
  console.error(pc.red(`error: ${msg}`));
  process.exit(2);
}

process.once("exit", killAllAnvils);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    killAllAnvils();
    process.exit(sig === "SIGINT" ? 130 : 143);
  });
}
await program.parseAsync(process.argv);
