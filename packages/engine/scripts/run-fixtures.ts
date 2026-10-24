// Dev check: runs every executable fixture through inspect() and prints the verdicts.
import { FIXTURES, fixtureRequest, inspect, loadConfig } from "../src/index";

const config = loadConfig();
const only = process.argv[2];
let failed = 0;
for (const f of FIXTURES.filter((x) => !only || x.id === only)) {
  const t = Date.now();
  const { diagnosis: d, evidence: e } = await inspect(fixtureRequest(f.id), { config });
  const ok = d.code === f.expectedCode;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${f.id.padEnd(20)} ${d.code.padEnd(20)} ${d.stage.padEnd(10)} ${d.responsible.label} | ${e.context.replay.exactness} | ${Date.now() - t} ms`);
  console.log(`     ${d.summary}`);
  console.log(`     lifecycle: ${d.lifecycle.map((s) => `${s.id}=${s.status}`).join(" ")} | trace ${e.replay.trace.status} | focus ${d.traceFocus}`);
  for (const i of d.inferences) console.log(`     infer: ${i.text}`);
  for (const c of d.corroboration) console.log(`     corrob: ${c}`);
  if (process.env.VERBOSE) console.log(JSON.stringify({ metrics: d.metrics, unknowns: d.unknowns, cmp: e.replay.comparison, ctx: e.context.replay, balances: e.balances }, null, 2));
}
process.exit(failed ? 1 : 0);
