import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet";
import { getDelegationContract, parseContractError, getOfferStatusLabel, getBondStatusLabel, ADDRESSES } from "@/lib/contracts";

export interface Offer {
  id: number;
  delegator: string;
  maxAmount: bigint;
  yieldRate: bigint;
  minScore: bigint;
  available: bigint;
  activeBonds: number;
  maxBonds: number;
  status: number;
  statusLabel: string;
}

export interface Bond {
  id: number;
  delegator: string;
  borrower: string;
  amount: bigint;
  repaid: bigint;
  yieldEarned: bigint;
  yieldPaidOut: bigint;  // V2 only
  yieldRate: bigint;
  dueDate: bigint;       // V2 only
  status: number;
  statusLabel: string;
  isExpired: boolean;    // V2 only
}

export function useDelegation() {
  const { signer, provider, address } = useWallet();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [myOffers, setMyOffers] = useState<Offer[]>([]);
  const [myBonds, setMyBonds] = useState<Bond[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const getContract = useCallback(() => {
    if (!signer) return null;
    return getDelegationContract(signer);
  }, [signer]);

  const getReadContract = useCallback(() => {
    if (!provider) return null;
    return getDelegationContract(provider);
  }, [provider]);

  // ── Load all active offers ────────────────────────────────────────────────
  const loadOffers = useCallback(async () => {
    const contract = getReadContract();
    if (!contract) return;
    try {
      const count = Number(await contract.offerCount());
      const now = Math.floor(Date.now() / 1000);
      const loaded: Offer[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const o = await contract.getOffer(i);
          loaded.push({
            id: i,
            delegator: o[0],
            maxAmount: BigInt(o[1]),
            yieldRate: BigInt(o[2]),
            minScore: BigInt(o[3]),
            available: BigInt(o[4]),
            activeBonds: Number(o[5]),
            maxBonds: Number(o[6]),
            status: Number(o[7]),
            statusLabel: getOfferStatusLabel(Number(o[7])),
          });
        } catch {}
      }
      setOffers(loaded);
    } catch (err: any) {
      console.error("loadOffers error:", err);
    }
  }, [getReadContract]);

  // ── Load user's own offers ────────────────────────────────────────────────
  const loadMyOffers = useCallback(async () => {
    if (!address) return;
    const contract = getReadContract();
    if (!contract) return;
    try {
      const ids: bigint[] = await contract.getDelegatorOffers(address);
      const loaded: Offer[] = [];
      for (const id of ids) {
        try {
          const o = await contract.getOffer(id);
          loaded.push({
            id: Number(id),
            delegator: o[0],
            maxAmount: BigInt(o[1]),
            yieldRate: BigInt(o[2]),
            minScore: BigInt(o[3]),
            available: BigInt(o[4]),
            activeBonds: Number(o[5]),
            maxBonds: Number(o[6]),
            status: Number(o[7]),
            statusLabel: getOfferStatusLabel(Number(o[7])),
          });
        } catch {}
      }
      setMyOffers(loaded);
    } catch (err: any) {
      console.error("loadMyOffers error:", err);
    }
  }, [address, getReadContract]);

  // ── Load user's bonds ─────────────────────────────────────────────────────
  const loadMyBonds = useCallback(async () => {
    if (!address) return;
    const contract = getReadContract();
    if (!contract) return;
    try {
      const ids: bigint[] = await contract.getBorrowerBonds(address);
      const now = Math.floor(Date.now() / 1000);
      const loaded: Bond[] = [];
      for (const id of ids) {
        try {
          const b = await contract.getBond(id);
          const isV2 = ADDRESSES.isV2Delegation;
          // V2 getBond returns 9 values; V1 returns 7
          const status = Number(isV2 ? b[8] : b[6]);
          const dueDate = isV2 ? BigInt(b[7]) : 0n;
          const isExpired = isV2 && status === 0 && Number(dueDate) > 0 && Number(dueDate) < now;

          loaded.push({
            id: Number(id),
            delegator: b[0],
            borrower: b[1],
            amount: BigInt(b[2]),
            repaid: BigInt(b[3]),
            yieldEarned: BigInt(b[4]),
            yieldPaidOut: isV2 ? BigInt(b[5]) : 0n,
            yieldRate: BigInt(isV2 ? b[6] : b[5]),
            dueDate,
            status,
            statusLabel: getBondStatusLabel(status),
            isExpired,
          });
        } catch {}
      }
      setMyBonds(loaded);
    } catch (err: any) {
      console.error("loadMyBonds error:", err);
    }
  }, [address, getReadContract]);

  // ── Transactions ──────────────────────────────────────────────────────────
  const createOffer = useCallback(async (
    maxAmountEth: string,
    yieldRateBps: number,
    minScore: number,
    maxBonds: number
  ) => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.createOffer(
        ethers.parseEther(maxAmountEth),
        BigInt(yieldRateBps),
        BigInt(minScore),
        BigInt(maxBonds)
      );
      setTxHash(tx.hash);
      await tx.wait();
      await Promise.all([loadOffers(), loadMyOffers()]);
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadOffers, loadMyOffers]);

  const cancelOffer = useCallback(async (offerId: number) => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.cancelOffer(offerId);
      setTxHash(tx.hash);
      await tx.wait();
      await Promise.all([loadOffers(), loadMyOffers()]);
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadOffers, loadMyOffers]);

  const acceptOffer = useCallback(async (
    offerId: number,
    amountEth: string,
    durationDays: number
  ) => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const durationSecs = durationDays * 24 * 60 * 60;
      const tx = await contract.acceptOffer(offerId, ethers.parseEther(amountEth), durationSecs);
      setTxHash(tx.hash);
      await tx.wait();
      await Promise.all([loadOffers(), loadMyBonds()]);
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadOffers, loadMyBonds]);

  const repayBond = useCallback(async (bondId: number, amountEth: string) => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.repayBond(bondId, { value: ethers.parseEther(amountEth) });
      setTxHash(tx.hash);
      await tx.wait();
      await Promise.all([loadOffers(), loadMyBonds()]);
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadOffers, loadMyBonds]);

  // V2: mark expired bond as defaulted (permissionless)
  const markExpiredDefault = useCallback(async (bondId: number) => {
    if (!ADDRESSES.isV2Delegation) return;
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.markExpiredDefault(bondId);
      setTxHash(tx.hash);
      await tx.wait();
      await loadMyBonds();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadMyBonds]);

  return {
    offers,
    myOffers,
    myBonds,
    loading,
    error,
    txHash,
    loadOffers,
    loadMyOffers,
    loadMyBonds,
    createOffer,
    cancelOffer,
    acceptOffer,
    repayBond,
    markExpiredDefault,
    clearError: () => setError(null),
    isV2: ADDRESSES.isV2Delegation,
  };
}
