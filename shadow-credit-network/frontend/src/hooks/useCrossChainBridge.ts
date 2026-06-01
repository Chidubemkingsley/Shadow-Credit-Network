import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet";
import { getCrossChainBridgeContract, getCreditEngineContract, parseContractError, ADDRESSES } from "@/lib/contracts";
import { isCoFHENetwork } from "@/lib/wallet";

export interface ReceivedScore {
  score: number;
  tier: number;
  tierLabel: string;
  computedAt: number;
  expiresAt: number;
  srcEid: number;
  exists: boolean;
  valid: boolean;
}

export interface BridgeState {
  localEid: number | null;
  hasEngine: boolean;
  hasEndpoint: boolean;
}

const TIER_LABELS = ["Unrated", "Deep Subprime", "Subprime", "Near Prime", "Prime"];

const DEFAULT_STATE: BridgeState = {
  localEid: null,
  hasEngine: false,
  hasEndpoint: false,
};

export function useCrossChainBridge() {
  const { signer, provider, address } = useWallet();
  const [bridgeState, setBridgeState] = useState<BridgeState>(DEFAULT_STATE);
  const [receivedScore, setReceivedScore] = useState<ReceivedScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [quotedFee, setQuotedFee] = useState<bigint | null>(null);

  const getReadContract = useCallback(() => {
    if (!provider) return null;
    return getCrossChainBridgeContract(provider);
  }, [provider]);

  const getWriteContract = useCallback(() => {
    if (!signer) return null;
    return getCrossChainBridgeContract(signer);
  }, [signer]);

  const loadBridgeState = useCallback(async () => {
    const contract = getReadContract();
    if (!contract) return;
    try {
      const [localEid, engine, ep] = await Promise.all([
        contract.localEid().catch(() => 0),
        contract.creditEngine().catch(() => ethers.ZeroAddress),
        contract.endpoint().catch(() => ethers.ZeroAddress),
      ]);
      setBridgeState({
        localEid: Number(localEid),
        hasEngine: engine !== ethers.ZeroAddress,
        hasEndpoint: ep !== ethers.ZeroAddress,
      });
    } catch (err: any) {
      console.error("loadBridgeState error:", err);
    }
  }, [getReadContract]);

  const loadReceivedScore = useCallback(async (user?: string) => {
    const contract = getReadContract();
    if (!contract) return;
    const who = user ?? address;
    if (!who) return;
    try {
      const rec = await contract.receivedScores(who);
      const exists = rec.exists ?? false;
      let valid = false;
      if (exists) {
        const now = Math.floor(Date.now() / 1000);
        valid = now <= Number(rec.expiresAt);
      }
      setReceivedScore({
        score: Number(rec.score),
        tier: Number(rec.tier),
        tierLabel: TIER_LABELS[Number(rec.tier)] ?? "Unknown",
        computedAt: Number(rec.computedAt),
        expiresAt: Number(rec.expiresAt),
        srcEid: Number(rec.srcEid),
        exists,
        valid,
      });
    } catch (err: any) {
      console.error("loadReceivedScore error:", err);
    }
  }, [getReadContract, address]);

  const sendScore = useCallback(async (dstEid: number) => {
    const contract = getWriteContract();
    if (!contract || !provider || !address) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      // Pre-checks
      const creditEngineAddr = await contract.creditEngine().catch(() => ethers.ZeroAddress);
      if (creditEngineAddr === ethers.ZeroAddress) {
        setError("Bridge has no credit engine configured.");
        return;
      }
      const creditEngine = getCreditEngineContract(provider);
      if (!creditEngine) {
        setError("Credit engine contract not found.");
        return;
      }
      const isRegistered = await creditEngine.isRegistered(address);
      if (!isRegistered) {
        setError("You must register on the credit engine first.");
        return;
      }
      const hasScore = await creditEngine.hasCreditScore(address);
      if (!hasScore) {
        setError("No credit score found — submit data and compute first.");
        return;
      }
      // Check published score (user SDK-decrypted + submitted on-chain) first,
      // then fall back to on-chain FHE-decrypted score.
      const publishedScore: bigint = await creditEngine.getPublishedScore(address);
      if (publishedScore === 0n) {
        const [score, isDecrypted] = await creditEngine.getDecryptedScore(address);
        if (!isDecrypted || score === 0) {
          setError(
            "Score is not published on-chain. Use the Dashboard to SDK-decrypt your score " +
            "and publish it via the 'Publish Score' button before bridging."
          );
          return;
        }
      }

      // Quote first — this will revert if no trusted remote is set for dstEid
      let fee: bigint;
      try {
        fee = await contract.quoteSend(dstEid);
      } catch (err: any) {
        setError(
          `Bridge is not configured for destination chain ${dstEid}. ` +
          `The contract owner must call setTrustedRemote(${dstEid}, remoteAddress) ` +
          `before cross-chain sends are available.`
        );
        return;
      }
      setQuotedFee(fee);

      const tx = await contract.sendScore(dstEid, { value: fee });
      setTxHash(tx.hash);
      await tx.wait();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getWriteContract, provider, address]);

  const quoteSend = useCallback(async (dstEid: number) => {
    const contract = getReadContract();
    if (!contract) return null;
    try {
      const fee = await contract.quoteSend(dstEid);
      setQuotedFee(fee);
      return fee;
    } catch (err: any) {
      // The LZ endpoint reverts when no trusted remote / peer is configured for
      // the destination chain. This is a setup issue, not a user error — the
      // bridge owner needs to call setTrustedRemote(dstEid, remoteAddress).
      const msg: string = err?.message ?? String(err);
      const isSetupError =
        msg.includes("No trusted remote") ||
        msg.includes("unknown custom error") ||
        msg.includes("CALL_EXCEPTION");
      if (isSetupError) {
        setError(
          `Bridge is not configured for destination chain ${dstEid}. ` +
          `The contract owner must call setTrustedRemote(${dstEid}, remoteAddress) ` +
          `before cross-chain sends are available.`
        );
      } else {
        setError(parseContractError(err));
      }
      console.error("quoteSend error:", err);
      return null;
    }
  }, [getReadContract]);

  const meetsThreshold = useCallback(async (user: string, minScore: number) => {
    const contract = getReadContract();
    if (!contract) return false;
    try {
      return await contract.meetsRemoteThreshold(user, minScore);
    } catch { return false; }
  }, [getReadContract]);

  return {
    bridgeState,
    receivedScore,
    loading,
    error,
    txHash,
    quotedFee,
    loadBridgeState,
    loadReceivedScore,
    sendScore,
    quoteSend,
    meetsThreshold,
    getReadContract,
    clearError: () => setError(null),
    hasAddress: !!ADDRESSES.crossChainBridge,
  };
}
