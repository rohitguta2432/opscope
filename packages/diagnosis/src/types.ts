import type { Address } from "viem";
import type { Check, Component, DecodedRevert, EvidenceSource, StageId } from "@opscope/core";

export type StageStatus = "passed" | "failed" | "warning" | "not_reached" | "not_applicable" | "unavailable";

export interface StageOutcome {
  id: StageId;
  label: string;
  status: StageStatus;
  summary: string;
  checks: Check[];
}

/** Something OpScope read or executed. Each carries its source. */
export interface Observation {
  id: string;
  text: string;
  source: EvidenceSource;
  values?: Record<string, string>;
}

/** An explanation derived from observations. Always labelled as inferred, with what it rests on. */
export interface Inference {
  id: string;
  text: string;
  basedOn: string[];
  confidence: "high" | "medium" | "low";
}

export interface SuggestedCheck {
  id: string;
  title: string;
  detail: string;
  /** a read-only or local command; OpScope never runs it on a public network */
  command?: string;
}

export interface Metric {
  label: string;
  value: string;
  tone?: "fail" | "pass" | "neutral";
}

export interface Diagnosis {
  verdict: "failed" | "passed" | "inconclusive";
  code: string;
  title: string;
  summary: string;
  stage: StageId;
  responsible: {
    component: Component;
    label: string;
    address?: Address;
    /** false when the responsible party is a best guess rather than shown by evidence */
    established: boolean;
    basis: string;
  };
  reason: { text: string; decoded?: DecodedRevert };
  lifecycle: StageOutcome[];
  observations: Observation[];
  inferences: Inference[];
  checks: SuggestedCheck[];
  unknowns: string[];
  limitations: string[];
  /** independent sources that agree on the verdict */
  corroboration: string[];
  confidence: "high" | "medium" | "low";
  metrics: Metric[];
  /** focus frame in the trace tree, if the trace shows where it failed */
  traceFocus?: string;
  exactness: string;
}
