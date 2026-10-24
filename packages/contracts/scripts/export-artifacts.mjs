// Copies the contract artifacts OpScope deploys into packages/engine/src/artifacts.
// EntryPoint, simulations and SimpleAccount come from the published
// @account-abstraction/contracts@0.7.0 release build (canonical bytecode);
// fixture-only contracts come from this Foundry project.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const aaDir = dirname(require.resolve("@account-abstraction/contracts/package.json"));
const aaVersion = JSON.parse(readFileSync(join(aaDir, "package.json"), "utf8")).version;
const outDir = join(here, "../../engine/src/artifacts");
mkdirSync(outDir, { recursive: true });

const abiDir = join(here, "../../core/src/abis");
mkdirSync(abiDir, { recursive: true });

// Full artifact (with bytecode) for the engine; ABI-only copy for browser-safe decoding in core.
const write = (name, a) => {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(a) + "\n");
  writeFileSync(join(abiDir, `${name}.json`), JSON.stringify(a.abi) + "\n");
};

for (const name of ["EntryPoint", "EntryPointSimulations", "SenderCreator", "SimpleAccount", "SimpleAccountFactory"]) {
  const a = JSON.parse(readFileSync(join(aaDir, "artifacts", `${name}.json`), "utf8"));
  write(name, {
    contractName: name,
    source: `@account-abstraction/contracts@${aaVersion}/${a.sourceName}`,
    abi: a.abi,
    bytecode: a.bytecode,
    deployedBytecode: a.deployedBytecode,
  });
}

for (const name of ["DemoToken", "SponsorPaymaster"]) {
  const a = JSON.parse(readFileSync(join(here, "../out", `${name}.sol`, `${name}.json`), "utf8"));
  write(name, {
    contractName: name,
    source: `packages/contracts/src/${name}.sol (forge, solc ${a.metadata?.compiler?.version ?? "0.8.28"})`,
    abi: a.abi,
    bytecode: a.bytecode.object,
    deployedBytecode: a.deployedBytecode.object,
  });
}
console.log(`artifacts written to ${outDir}`);
