import { useState, useCallback } from "react";
import { useWallet } from "@/lib/wallet";
import { getReputationContract, parseContractError, ADDRESSES } from "@/lib/contracts";

// Chain IDs where CoFHE FHE.decrypt() is available
const COFHE_CHAIN_IDS = new Set([8008135, 412346]); // Fhenix Helium, localcofhe

export interface ReputationProfile {
  isRegistered: boolean;
  compositeScore: number | null;   // 0-10000 bps
  isDecrypted: boolean;
  registeredAt: number;
  lastActivityAt: number;
  activeAttestations: number;
  decayInterval: number;           // seconds
  minAttestations: number;
}

const DEFAULT_REP: ReputationProfile = {
  isRegistered: false,
  compositeScore: null,
  isDecrypted: false,
  registeredAt: 0,
  lastActivityAt: 0,
  activeAttestations: 0,
  decayInterval: 90 * 24 * 60 * 60,
  minAttestations: 2,
};

export const REPUTATION_FACTORS = [
  { name: "Transaction Reliability", weight: 30, index: 0 },
  { name: "Staking History",         weight: 20, index: 1 },
  { name: "Governance Participation",weight: 15, index: 2 },
  { name: "Protocol Interaction",    weight: 15, index: 3 },
  { name: "Social Verification",     weight: 10, index: 4 },
  { name: "Default History (inv.)",  weight: 10, index: 5 },
] as const;

export function useReputation() {
  const { signer, provider, address, chainId } = useWallet();
  const [repProfile, setRepProfile] = useState<ReputationProfile>(DEFAULT_REP);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const getContract = useCallback(() => {
    if (!signer) return null;
    return getReputationContract(signer);
  }, [signer]);

  const getReadContract = useCallback(() => {
    if (!provider) return null;
    return getReputationContract(provider);
  }, [provider]);

  const hasRegistry = !!ADDRESSES.reputation;
  // FHE.decrypt() only works on CoFHE-enabled networks
  const isFHENetwork = chainId !== null && COFHE_CHAIN_IDS.has(chainId);

  // ── Load reputation profile ───────────────────────────────────────────────
  const loadReputation = useCallback(async () => {
    if (!address || !hasRegistry) return;
    const contract = getReadContract();
    if (!contract) return;
    try {
      const isRegistered = await contract.isRegistered(address);
      if (!isRegistered) {
        setRepProfile({ ...DEFAULT_REP, isRegistered: false });
        return;
      }

      const [registeredAt, lastActivityAt, activeAttestations, decayInterval, minAttestations] =
        await Promise.all([
          contract.getRegisteredAt(address),
          contract.getLastActivityAt(address),
          contract.getActiveAttestationCount(address),
          contract.decayInterval(),
          contract.minAttestations(),
        ]);

      // Poll decrypted score
      let compositeScore: number | null = null;
      let isDecrypted = false;
      try {
        const [score, decrypted] = await contract.getDecryptedScoreSafe();
        if (decrypted) {
          compositeScore = Number(score);
          isDecrypted = true;
        }
      } catch {}

      setRepProfile({
        isRegistered: true,
        compositeScore,
        isDecrypted,
        registeredAt: Number(registeredAt),
        lastActivityAt: Number(lastActivityAt),
        activeAttestations: Number(activeAttestations),
        decayInterval: Number(decayInterval),
        minAttestations: Number(minAttestations),
      });
    } catch (err: any) {
      console.error("loadReputation error:", err);
    }
  }, [address, hasRegistry, getReadContract]);

  // ── Transactions ──────────────────────────────────────────────────────────
  const register = useCallback(async () => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.register();
      setTxHash(tx.hash);
      await tx.wait();
      await loadReputation();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadReputation]);

  const requestDecryption = useCallback(async () => {
    // FHE.decrypt() requires CoFHE task manager — not deployed on Base Sepolia.
    // Intercept here so the wallet popup never fires with a guaranteed revert.
    if (!isFHENetwork) {
      setError(
        "FHE decryption requires a CoFHE-enabled network (Fhenix Helium or localcofhe). " +
        "Base Sepolia does not have the FHE task manager deployed. " +
        "Your reputation score is stored as an encrypted ciphertext on-chain — " +
        "it is valid for protocol operations but cannot be revealed on this network."
      );
      return;
    }
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.requestDecryption();
      setTxHash(tx.hash);
      await tx.wait();
      await loadReputation();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadReputation, isFHENetwork]);

  // applyDecay is permissionless — callable by anyone for any user
  const applyDecay = useCallback(async (targetAddress?: string) => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const target = targetAddress ?? address;
      if (!target) return;
      const tx = await contract.applyDecay(target);
      setTxHash(tx.hash);
      await tx.wait();
      await loadReputation();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, address, loadReputation]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const canApplyDecay = useCallback((): boolean => {
    if (!repProfile.isRegistered) return false;
    const now = Math.floor(Date.now() / 1000);
    return now - repProfile.lastActivityAt >= repProfile.decayInterval;
  }, [repProfile]);

  const daysUntilDecay = useCallback((): number => {
    if (!repProfile.isRegistered) return 0;
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - repProfile.lastActivityAt;
    const remaining = repProfile.decayInterval - elapsed;
    return Math.max(0, Math.ceil(remaining / 86400));
  }, [repProfile]);

  return {
    repProfile,
    loading,
    error,
    txHash,
    hasRegistry,
    isFHENetwork,
    loadReputation,
    register,
    requestDecryption,
    applyDecay,
    canApplyDecay,
    daysUntilDecay,
    clearError: () => setError(null),
  };
}
