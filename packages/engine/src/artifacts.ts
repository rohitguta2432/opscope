import type { Abi, Hex } from "viem";
import EntryPoint from "./artifacts/EntryPoint.json" with { type: "json" };
import EntryPointSimulations from "./artifacts/EntryPointSimulations.json" with { type: "json" };
import SenderCreator from "./artifacts/SenderCreator.json" with { type: "json" };
import SimpleAccount from "./artifacts/SimpleAccount.json" with { type: "json" };
import SimpleAccountFactory from "./artifacts/SimpleAccountFactory.json" with { type: "json" };
import DemoToken from "./artifacts/DemoToken.json" with { type: "json" };
import SponsorPaymaster from "./artifacts/SponsorPaymaster.json" with { type: "json" };

export interface Artifact {
  contractName: string;
  /** where the bytecode came from, recorded in every replay context */
  source: string;
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
}

const a = (x: unknown) => x as Artifact;

export const artifacts = {
  EntryPoint: a(EntryPoint),
  EntryPointSimulations: a(EntryPointSimulations),
  SenderCreator: a(SenderCreator),
  SimpleAccount: a(SimpleAccount),
  SimpleAccountFactory: a(SimpleAccountFactory),
  DemoToken: a(DemoToken),
  SponsorPaymaster: a(SponsorPaymaster),
};
