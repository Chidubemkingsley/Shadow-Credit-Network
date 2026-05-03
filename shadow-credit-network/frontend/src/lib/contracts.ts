// ─────────────────────────────────────────────────────────────────────────────
//  Contract address resolution
//  Prefers Wave 3 addresses (V3/V2) when set, falls back to Wave 1 live contracts.
// ─────────────────────────────────────────────────────────────────────────────
import { ethers } from "ethers";
import {
  CREDIT_ENGINE_V3_ABI,
  SIMPLE_CREDIT_ENGINE_ABI,
  LOAN_POOL_V3_ABI,
  LOAN_POOL_ABI,
  DELEGATION_V2_ABI,
  DELEGATION_ABI,
  REPUTATION_REGISTRY_ABI,
} from "./abis";

const env = import.meta.env;

export const ADDRESSES = {
  creditEngine:   env.VITE_CREDIT_ENGINE_V3_ADDRESS   || env.VITE_SIMPLE_CREDIT_ENGINE_ADDRESS || "",
  loanPool:       env.VITE_LOAN_POOL_V3_ADDRESS        || env.VITE_LOAN_POOL_ADDRESS            || "",
  delegation:     env.VITE_DELEGATION_V2_ADDRESS       || env.VITE_DELEGATION_ADDRESS           || "",
  reputation:     env.VITE_REPUTATION_REGISTRY_ADDRESS || "",
  // Flags so UI can show which version is active
  isV3Engine:     !!env.VITE_CREDIT_ENGINE_V3_ADDRESS,
  isV3Pool:       !!env.VITE_LOAN_POOL_V3_ADDRESS,
  isV2Delegation: !!env.VITE_DELEGATION_V2_ADDRESS,
} as const;

// ── Contract factory helpers ──────────────────────────────────────────────────

export function getCreditEngineContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  if (!ADDRESSES.creditEngine) return null;
  const abi = ADDRESSES.isV3Engine ? CREDIT_ENGINE_V3_ABI : SIMPLE_CREDIT_ENGINE_ABI;
  return new ethers.Contract(ADDRESSES.creditEngine, abi, signerOrProvider);
}

export function getLoanPoolContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  if (!ADDRESSES.loanPool) return null;
  const abi = ADDRESSES.isV3Pool ? LOAN_POOL_V3_ABI : LOAN_POOL_ABI;
  return new ethers.Contract(ADDRESSES.loanPool, abi, signerOrProvider);
}

export function getDelegationContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  if (!ADDRESSES.delegation) return null;
  const abi = ADDRESSES.isV2Delegation ? DELEGATION_V2_ABI : DELEGATION_ABI;
  return new ethers.Contract(ADDRESSES.delegation, abi, signerOrProvider);
}

export function getReputationContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  if (!ADDRESSES.reputation) return null;
  return new ethers.Contract(ADDRESSES.reputation, REPUTATION_REGISTRY_ABI, signerOrProvider);
}

// ── Score formula (client-side preview — matches on-chain formula exactly) ───
export function computeScorePreview(
  paymentHistory: number,  // 0-10000 bps
  creditUtilization: number, // 0-10000 bps
  accountAge: number,      // days
  numDefaults: number
): number {
  const paymentScore = (paymentHistory * 255) / 10000;
  const utilScore = ((10000 - creditUtilization) * 120) / 10000;
  const years = Math.min(accountAge / 365, 10);
  const ageScore = years * 15;
  const penalty = numDefaults * 50;
  const raw = 300 + paymentScore + utilScore + ageScore - penalty;
  return Math.max(300, Math.min(850, Math.round(raw)));
}

export function getRiskTierFromScore(score: number): { tier: string; color: string; factor: number } {
  if (score >= 740) return { tier: "Prime",        color: "text-success",     factor: 50 };
  if (score >= 670) return { tier: "Near Prime",   color: "text-primary",     factor: 30 };
  if (score >= 580) return { tier: "Subprime",     color: "text-warning",     factor: 15 };
  return              { tier: "Deep Subprime", color: "text-destructive", factor: 5  };
}

export function getLoanStatusLabel(status: number): string {
  return ["Pending", "Active", "Repaid", "Defaulted"][status] ?? "Unknown";
}

export function getOfferStatusLabel(status: number): string {
  return ["Active", "Cancelled", "Exhausted"][status] ?? "Unknown";
}

export function getBondStatusLabel(status: number): string {
  return ["Active", "Repaid", "Defaulted"][status] ?? "Unknown";
}

// ── Error parsing ─────────────────────────────────────────────────────────────
export function parseContractError(err: any): string {
  if (err?.reason) return err.reason;
  if (err?.data?.message) return err.data.message;
  const msg: string = err?.message ?? String(err);
  // Extract revert reason from ethers error message
  const match = msg.match(/reverted with reason string '(.+?)'/);
  if (match) return match[1];
  const customMatch = msg.match(/reverted with custom error '(\w+)'/);
  if (customMatch) return customMatch[1];
  if (msg.includes("user rejected")) return "Transaction rejected";
  if (msg.includes("insufficient funds")) return "Insufficient ETH balance";
  if (msg.includes("StaleScore")) return "Credit score is stale — recompute your score first";
  if (msg.includes("NoCreditScore")) return "No credit score found — submit data and compute first";
  if (msg.includes("NotRegistered")) return "Not registered — register first";
  if (msg.includes("AlreadyRegistered")) return "Already registered";
  if (msg.includes("InsufficientLiquidity")) return "Insufficient pool liquidity";
  if (msg.includes("NoYieldToClaim")) return "No yield to claim";
  if (msg.includes("BondNotExpired")) return "Bond has not expired yet";
  if (msg.includes("InsufficientCreditScore")) return "Credit score too low for this offer";
  return msg.slice(0, 120);
}
