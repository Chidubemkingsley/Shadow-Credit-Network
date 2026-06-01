import { useState, useCallback } from "react";
import { useWallet } from "@/lib/wallet";
import { getReputationContract, parseContractError, ADDRESSES } from "@/lib/contracts";
import { FheTypes } from "@cofhe/sdk";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/web";
import { Ethers6Adapter } from "@cofhe/sdk/adapters";
import { arbSepolia } from "@cofhe/sdk/chains";

const COFHE_CHAIN_IDS = new Set([421614, 8008135, 412346]);

export interface ReputationProfile {
  isRegistered: boolean;
  compositeScore: number | null;
  isDecrypted: boolean;
  registeredAt: number;
  lastActivityAt: number;
  activeAttestations: number;
  decayInterval: number;
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
  const isFHENetwork = chainId !== null && COFHE_CHAIN_IDS.has(chainId);

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

      setRepProfile({
        isRegistered: true,
        compositeScore: null,
        isDecrypted: false,
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
    if (!isFHENetwork) {
      setError(
        "FHE decryption requires a CoFHE-enabled network (Arbitrum Sepolia, Fhenix Helium, or localcofhe)."
      );
      return;
    }
    const contract = getContract();
    if (!contract || !signer || !address) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const handle: bigint = await contract.getMyScoreHandle();

      if (handle === 0n) {
        setError("Score handle is zero — ensure you are registered and a score has been computed.");
        return;
      }

      const config = createCofheConfig({ supportedChains: [arbSepolia], useWorkers: false });
      const client = createCofheClient(config);
      const adapter = await Ethers6Adapter(provider, signer);
      await client.connect(adapter.publicClient, adapter.walletClient);
      await client.permits.getOrCreateSelfPermit();
      const decrypted = await client
        .decryptForView(handle, FheTypes.Uint32)
        .withPermit()
        .execute();

      const score = Number(decrypted.toString());
      setRepProfile((prev) => ({
        ...prev,
        compositeScore: score,
        isDecrypted: true,
      }));
    } catch (err: any) {
      const msg = parseContractError(err);
      console.error("[Reputation] requestDecryption error:", err, msg);
      if (msg.includes("require(false)") || msg.includes("execution reverted")) {
        setError(
          "Decryption reverted. This can happen if the CoFHE threshold network cannot resolve " +
          "the ciphertext handle. Your score is still valid for protocol operations."
        );
      } else {
        setError(msg);
      }
    } finally { setLoading(false); }
  }, [getContract, signer, provider, address, isFHENetwork]);

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
