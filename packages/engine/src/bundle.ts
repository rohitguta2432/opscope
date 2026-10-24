import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { zipSync, strToU8 } from "fflate";
import type { Address, Hex } from "viem";
import type { BlockSelector, ConnectionRef, InspectRequest, RpcUserOperation } from "@opscope/core";
import { renderDiagnosisMarkdown, reproduceCommand, type Session } from "@opscope/diagnosis";

export interface ReplayConfigFile {
  schema: "opscope.replay/v1";
  sessionId: string;
  createdAt: string;
  label: string;
  demo: boolean;
  chainId: number;
  entryPoint: Address;
  connection: ConnectionRef;
  /** the block the replay is pinned to, by number and hash (or the inclusion tx) */
  block: BlockSelector;
  mode: InspectRequest["mode"];
  fixture?: { id: string; version: number };
  expected: { code: string; stage: string; verdict: string; userOpHash: Hex };
  pins: {
    blockNumber: string;
    blockHash: Hex;
    entryPointCodeHash?: Hex;
    accountImplementation?: string;
    replayMode: string;
    exactness: string;
    forkAfterTx?: Hex;
    precedingTxs: number;
    stateOverrides: unknown[];
    blockEnv: unknown[];
    tools: Record<string, string | undefined>;
  };
}

export interface UserOpFile {
  chainId: number;
  entryPoint: Address;
  userOpHash: Hex;
  userOperation: RpcUserOperation;
  packed: unknown;
}

/** Every file in a reproduction bundle. Evidence is already redacted when it is stored. */
export function bundleFiles(s: Session): Record<string, string> {
  if (!s.evidence || !s.diagnosis) throw new Error(`Session ${s.id} has no result to export (status: ${s.status}).`);
  const e = s.evidence;
  const d = s.diagnosis;
  const ctx = e.context;
  const block: BlockSelector = ctx.inclusion ? { kind: "inclusion", txHash: ctx.inclusion.txHash } : { kind: "number", number: ctx.block.number, hash: ctx.block.hash };
  const replay: ReplayConfigFile = {
    schema: "opscope.replay/v1",
    sessionId: s.id,
    createdAt: s.createdAt,
    label: s.label,
    demo: s.demo,
    chainId: e.chainId,
    entryPoint: e.entryPoint,
    connection: s.request.connection,
    block,
    mode: s.request.mode,
    fixture: ctx.fixture ? { id: ctx.fixture.id, version: ctx.fixture.version } : undefined,
    expected: { code: d.code, stage: d.stage, verdict: d.verdict, userOpHash: e.userOpHash },
    pins: {
      blockNumber: ctx.block.number,
      blockHash: ctx.block.hash,
      entryPointCodeHash: ctx.entryPoint.codeHash,
      accountImplementation: ctx.account.implementation?.codeHash ?? ctx.account.implementation?.label,
      replayMode: ctx.replay.mode,
      exactness: ctx.replay.exactness,
      forkAfterTx: ctx.replay.forkAfterTx,
      precedingTxs: ctx.replay.precedingTxs,
      stateOverrides: ctx.replay.stateOverrides,
      blockEnv: ctx.replay.blockEnv,
      tools: { ...ctx.tools },
    },
  };
  const userop: UserOpFile = { chainId: e.chainId, entryPoint: e.entryPoint, userOpHash: e.userOpHash, userOperation: e.userOp, packed: e.packed };
  const cmd = reproduceCommand(s.id);
  const files: Record<string, string> = {
    "diagnosis.md": renderDiagnosisMarkdown(e, d, { sessionId: s.id, reproduceCommand: cmd, demo: s.demo }),
    "userop.json": JSON.stringify(userop, null, 2) + "\n",
    "replay.config.json": JSON.stringify(replay, null, 2) + "\n",
    "evidence.json": JSON.stringify(e, null, 2) + "\n",
    "REPRODUCE.md": reproduceDoc(s, replay, cmd),
  };
  if (e.replay.trace.status === "ok") files["trace.json"] = JSON.stringify({ method: e.replay.trace.method, root: e.replay.trace.root }, null, 2) + "\n";
  const manifest = Object.entries(files).map(([name, body]) => ({ name, bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") }));
  files["manifest.json"] = JSON.stringify({ schema: "opscope.bundle/v1", sessionId: s.id, files: manifest }, null, 2) + "\n";
  return files;
}

function reproduceDoc(s: Session, r: ReplayConfigFile, cmd: string) {
  const live = r.connection.kind === "rpc";
  return [
    `# Reproduce ${r.expected.code}`,
    "",
    "```",
    cmd,
    "```",
    "",
    live
      ? `Needs an RPC connection with id \`${r.connection.kind === "rpc" ? r.connection.id : ""}\` for chain ${r.chainId} in your opscope.config.json (or pass --connection). The bundle never contains the RPC URL.`
      : `Rebuilds the deterministic fixture \`${r.fixture?.id}\` v${r.fixture?.version} on a local Anvil chain; no network access needed.`,
    "",
    `The replay is pinned to block ${r.pins.blockNumber} (${r.pins.blockHash})${r.block.kind === "inclusion" ? `, re-executing inclusion transaction ${r.block.txHash}` : ""}. It checks the block hash first and refuses to continue on a mismatch.`,
    "",
    `Expected result: ${r.expected.code} at stage ${r.expected.stage} (${r.expected.verdict}). Exactness of the original run: ${r.pins.exactness}.`,
    "",
  ].join("\n");
}

export function writeBundleDir(dir: string, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return resolve(dir);
}

export function zipBundle(files: Record<string, string>, root: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(files)) entries[`${root}/${name}`] = strToU8(body);
  return zipSync(entries, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") });
}

export function readBundleDir(dir: string): { replay: ReplayConfigFile; userop: UserOpFile } {
  const p = (f: string) => join(dir, f);
  if (!existsSync(p("replay.config.json"))) throw new Error(`${dir} is not an OpScope bundle (replay.config.json missing).`);
  const replay = JSON.parse(readFileSync(p("replay.config.json"), "utf8")) as ReplayConfigFile;
  if (replay.schema !== "opscope.replay/v1") throw new Error(`Unsupported bundle schema ${replay.schema}`);
  const userop = JSON.parse(readFileSync(p("userop.json"), "utf8")) as UserOpFile;
  return { replay, userop };
}

/** The inspect request that re-runs a bundle at exactly its pinned block. */
export function requestFromBundle(b: { replay: ReplayConfigFile; userop: UserOpFile }, connectionOverride?: string): InspectRequest {
  const r = b.replay;
  return {
    userOp: b.userop.userOperation,
    chainId: r.chainId,
    entryPoint: r.entryPoint,
    connection: connectionOverride ? { kind: "rpc", id: connectionOverride } : r.connection,
    block: r.block,
    mode: r.mode,
    label: `Replay of ${r.sessionId}`,
  };
}
