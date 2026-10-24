import type { Component, StageId } from "./types";

export interface AaErrorInfo {
  code: string;
  /** exact reason string EntryPoint v0.7 reverts with */
  reason: string;
  stage: StageId;
  component: Component;
  title: string;
  explanation: string;
  checks: { title: string; detail: string }[];
}

/** Every FailedOp reason EntryPoint v0.7 and EntryPointSimulations v0.7 can produce. */
export const AA_ERRORS: AaErrorInfo[] = [
  {
    code: "AA10",
    reason: "AA10 sender already constructed",
    stage: "account",
    component: "factory",
    title: "Account already deployed",
    explanation: "The operation carries initCode (factory + factoryData), but the sender already has code. EntryPoint only runs the factory for undeployed accounts.",
    checks: [{ title: "Drop the factory fields", detail: "Remove factory/factoryData for every operation after the first one from this account." }],
  },
  {
    code: "AA13",
    reason: "AA13 initCode failed or OOG",
    stage: "account",
    component: "factory",
    title: "Account factory call failed",
    explanation: "SenderCreator called the factory and got no address back: the factory reverted or ran out of verificationGasLimit.",
    checks: [
      { title: "Check the factory call", detail: "Decode factoryData against the factory ABI and run it with eth_call from the SenderCreator address." },
      { title: "Raise verificationGasLimit", detail: "Account deployment costs far more than validation alone; deploy-time limits are often 300k+." },
    ],
  },
  {
    code: "AA14",
    reason: "AA14 initCode must return sender",
    stage: "account",
    component: "factory",
    title: "Factory returned a different address",
    explanation: "The factory deployed (or returned) an address that is not the operation's sender. The counterfactual address and the factory inputs disagree.",
    checks: [{ title: "Recompute the counterfactual address", detail: "Call the factory's getAddress(owner, salt) with the exact factoryData inputs and compare with sender." }],
  },
  {
    code: "AA15",
    reason: "AA15 initCode must create sender",
    stage: "account",
    component: "factory",
    title: "Factory did not deploy the account",
    explanation: "The factory returned the sender address but left no code there.",
    checks: [{ title: "Inspect the factory", detail: "The factory must actually deploy the account (not just compute its address)." }],
  },
  {
    code: "AA20",
    reason: "AA20 account not deployed",
    stage: "account",
    component: "account",
    title: "Account not deployed",
    explanation: "The sender has no code and the operation has no initCode, so there is nothing to validate it.",
    checks: [{ title: "Add initCode", detail: "Set factory and factoryData for the account's first operation, or deploy the account first." }],
  },
  {
    code: "AA21",
    reason: "AA21 didn't pay prefund",
    stage: "account",
    component: "account",
    title: "Account didn't pay prefund",
    explanation: "With no paymaster, the account must cover the maximum gas cost up front. After validateUserOp, its EntryPoint deposit was still below the required prefund.",
    checks: [
      { title: "Fund the account", detail: "Send ETH to the account (it pays the missing amount during validation) or call EntryPoint.depositTo(account)." },
      { title: "Check the gas limits", detail: "Required prefund = (all gas limits) × maxFeePerGas; inflated limits or fees raise it." },
      { title: "Or add a paymaster", detail: "A sponsor pays the prefund from its own EntryPoint deposit." },
    ],
  },
  {
    code: "AA22",
    reason: "AA22 expired or not due",
    stage: "account",
    component: "account",
    title: "Account signature outside its time window",
    explanation: "validateUserOp returned validAfter/validUntil and the block timestamp falls outside that window.",
    checks: [{ title: "Re-sign with a current window", detail: "Compare validAfter/validUntil with the block timestamp; clocks and slow signing flows cause this." }],
  },
  {
    code: "AA23",
    reason: "AA23 reverted",
    stage: "account",
    component: "account",
    title: "Account validation reverted",
    explanation: "The account's validateUserOp reverted instead of returning a result. The inner revert data says why.",
    checks: [{ title: "Decode the inner revert", detail: "Common causes: malformed signature bytes, wrong EntryPoint in the account, or the account paying prefund without enough ETH." }],
  },
  {
    code: "AA24",
    reason: "AA24 signature error",
    stage: "account",
    component: "account",
    title: "Invalid account signature",
    explanation: "The account's validateUserOp returned SIG_VALIDATION_FAILED (or an aggregator that doesn't match), so EntryPoint rejected the signature.",
    checks: [
      { title: "Sign the v0.7 userOpHash", detail: "keccak256(abi.encode(hash(packedOp), entryPoint, chainId)) — check the chainId and EntryPoint you hashed with." },
      { title: "Sign with the owner key", detail: "Recover the signer and compare it with the account's owner." },
      { title: "Sign after the last field change", detail: "Any change to gas, fees or paymaster fields after signing invalidates the hash." },
    ],
  },
  {
    code: "AA25",
    reason: "AA25 invalid account nonce",
    stage: "account",
    component: "account",
    title: "Nonce mismatch",
    explanation: "The nonce's sequence doesn't match EntryPoint's next sequence for this sender and key.",
    checks: [
      { title: "Read the next nonce", detail: "EntryPoint.getNonce(sender, key) returns the full nonce the next operation must use." },
      { title: "Look for an earlier operation", detail: "A previous operation from this account may already have consumed the nonce (resubmission, parallel sends)." },
    ],
  },
  {
    code: "AA26",
    reason: "AA26 over verificationGasLimit",
    stage: "account",
    component: "account",
    title: "Validation used more gas than allowed",
    explanation: "Account validation (plus deployment, if any) used more gas than verificationGasLimit.",
    checks: [{ title: "Re-estimate", detail: "Raise verificationGasLimit or re-run gas estimation with a realistic signature." }],
  },
  {
    code: "AA30",
    reason: "AA30 paymaster not deployed",
    stage: "paymaster",
    component: "paymaster",
    title: "Paymaster not deployed",
    explanation: "paymasterAndData points at an address with no code on this chain.",
    checks: [{ title: "Check the paymaster address and chain", detail: "Sponsors are deployed per chain; the address may belong to another network." }],
  },
  {
    code: "AA31",
    reason: "AA31 paymaster deposit too low",
    stage: "paymaster",
    component: "paymaster",
    title: "Paymaster deposit too low",
    explanation: "The paymaster's EntryPoint deposit is below the operation's required prefund. EntryPoint checks this before calling the paymaster at all.",
    checks: [
      { title: "Top up the paymaster deposit", detail: "Call EntryPoint.depositTo(paymaster) with at least the shortfall; deposits drain as sponsored operations pay gas." },
      { title: "Check the requested gas", detail: "Required prefund = (all gas limits) × maxFeePerGas; oversized limits can exceed a healthy deposit." },
    ],
  },
  {
    code: "AA32",
    reason: "AA32 paymaster expired or not due",
    stage: "paymaster",
    component: "paymaster",
    title: "Sponsorship outside its time window",
    explanation: "The paymaster returned validAfter/validUntil and the block timestamp falls outside that window.",
    checks: [{ title: "Request fresh sponsorship", detail: "Paymaster signatures usually expire within minutes." }],
  },
  {
    code: "AA33",
    reason: "AA33 reverted",
    stage: "paymaster",
    component: "paymaster",
    title: "Paymaster validation reverted",
    explanation: "validatePaymasterUserOp reverted: the sponsor refused this operation. The inner revert data says why.",
    checks: [{ title: "Decode the inner revert", detail: "Policy rejections (allowlists, spend caps, expired sponsorship data) show up here." }],
  },
  {
    code: "AA34",
    reason: "AA34 signature error",
    stage: "paymaster",
    component: "paymaster",
    title: "Invalid paymaster signature",
    explanation: "The paymaster returned a signature failure in its validation data.",
    checks: [{ title: "Re-request paymasterData", detail: "The sponsor's signature must cover the final operation fields." }],
  },
  {
    code: "AA36",
    reason: "AA36 over paymasterVerificationGasLimit",
    stage: "paymaster",
    component: "paymaster",
    title: "Paymaster validation used too much gas",
    explanation: "validatePaymasterUserOp used more gas than paymasterVerificationGasLimit.",
    checks: [{ title: "Raise paymasterVerificationGasLimit", detail: "Use the sponsor's recommended limit." }],
  },
  {
    code: "AA90",
    reason: "AA90 invalid beneficiary",
    stage: "execution",
    component: "bundler",
    title: "Invalid beneficiary",
    explanation: "handleOps was called with the zero address as beneficiary.",
    checks: [{ title: "Bundler configuration", detail: "This comes from the bundler's transaction, not the operation." }],
  },
  {
    code: "AA91",
    reason: "AA91 failed send to beneficiary",
    stage: "execution",
    component: "bundler",
    title: "Could not pay the beneficiary",
    explanation: "EntryPoint could not transfer collected fees to the beneficiary.",
    checks: [{ title: "Bundler configuration", detail: "The beneficiary must accept ETH." }],
  },
  {
    code: "AA92",
    reason: "AA92 internal call only",
    stage: "execution",
    component: "entrypoint",
    title: "Internal EntryPoint function called externally",
    explanation: "innerHandleOp can only be called by EntryPoint itself.",
    checks: [{ title: "Call handleOps", detail: "Submit through handleOps, not innerHandleOp." }],
  },
  {
    code: "AA93",
    reason: "AA93 invalid paymasterAndData",
    stage: "paymaster",
    component: "userop",
    title: "Malformed paymasterAndData",
    explanation: "paymasterAndData is shorter than 52 bytes (address + two 16-byte gas limits).",
    checks: [{ title: "Pack the v0.7 paymaster fields", detail: "paymaster ‖ uint128 verificationGasLimit ‖ uint128 postOpGasLimit ‖ paymasterData." }],
  },
  {
    code: "AA94",
    reason: "AA94 gas values overflow",
    stage: "account",
    component: "userop",
    title: "Gas value too large",
    explanation: "A gas or fee field exceeds uint120, which EntryPoint rejects to keep its arithmetic safe.",
    checks: [{ title: "Check unit conversions", detail: "Fees are in wei; a value in ether-units ×1e18 twice overflows." }],
  },
  {
    code: "AA95",
    reason: "AA95 out of gas",
    stage: "execution",
    component: "bundler",
    title: "handleOps transaction ran out of gas",
    explanation: "The bundle transaction didn't leave enough gas for callGasLimit + postOp. This is the bundler's gas limit, not the operation's.",
    checks: [{ title: "Raise the handleOps gas limit", detail: "Bundlers must cover all operation limits plus EntryPoint overhead." }],
  },
  {
    code: "AA96",
    reason: "AA96 invalid aggregator",
    stage: "account",
    component: "account",
    title: "Invalid aggregator",
    explanation: "The aggregator address is the reserved signature-failed marker.",
    checks: [{ title: "Check the aggregator", detail: "Use handleOps for non-aggregated accounts." }],
  },
];

export function lookupAaError(reasonOrCode: string): AaErrorInfo | undefined {
  const code = /AA\d{2}/.exec(reasonOrCode)?.[0];
  if (!code) return undefined;
  return AA_ERRORS.find((e) => e.code === code);
}
