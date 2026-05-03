import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet";
import { getCreditEngineContract, parseContractError, getRiskTierFromScore, ADDRESSES } from "@/lib/contracts";

export interface CreditProfile {
  isRegistered: boolean;
  hasCreditScore: boolean;
  score: number | null;
  isDecrypted: boolean;
  riskTier: string;
  riskColor: string;
  riskFactor: number;
  scoreComputedAt: number | null;
  isScoreStale: boolean;
  scoreHistoryLength: number;
  hasBorrowingPower: boolean;
  scoreCtHash: string | null;   // ciphertext handle — available even without decryption
}

// ── InEuint struct builder ────────────────────────────────────────────────────
// The CoFHE SDK returns EncryptedItemInput objects:
//   { ctHash: bigint, securityZone: number, utype: number, signature: string }
// These map directly to the Solidity InEuint* struct:
//   struct InEuint64 { uint256 ctHash; uint8 securityZone; uint8 utype; bytes signature; }
//
// If you have the CoFHE SDK output, pass it directly to submitCreditDataEncrypted().
// For the live Base Sepolia deployment (SimpleCreditEngine V1), use submitCreditData()
// which sends plaintext values — the V1 contract stores them as uint256.
export interface CoFHEEncryptedInput {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: string;
}

export interface EncryptedCreditInputs {
  income: CoFHEEncryptedInput;
  totalDebt: CoFHEEncryptedInput;
  paymentHistory: CoFHEEncryptedInput;
  creditUtilization: CoFHEEncryptedInput;
  accountAge: CoFHEEncryptedInput;
  numDefaults: CoFHEEncryptedInput;
}

const DEFAULT_PROFILE: CreditProfile = {
  isRegistered: false,
  hasCreditScore: false,
  score: null,
  isDecrypted: false,
  riskTier: "Unknown",
  riskColor: "text-muted-foreground",
  riskFactor: 0,
  scoreComputedAt: null,
  isScoreStale: false,
  scoreHistoryLength: 0,
  hasBorrowingPower: false,
  scoreCtHash: null,
};

export function useCreditEngine() {
  const { signer, provider, address } = useWallet();
  const [profile, setProfile] = useState<CreditProfile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const getContract = useCallback(() => {
    if (!signer) return null;
    return getCreditEngineContract(signer);
  }, [signer]);

  const getReadContract = useCallback(() => {
    if (!provider) return null;
    return getCreditEngineContract(provider);
  }, [provider]);

  // ── Load profile from chain ───────────────────────────────────────────────
  const loadProfile = useCallback(async () => {
    if (!address) return;
    const contract = getReadContract();
    if (!contract) return;

    try {
      const isRegistered = await contract.isRegistered(address);
      if (!isRegistered) {
        setProfile({ ...DEFAULT_PROFILE, isRegistered: false });
        return;
      }

      const isV3 = ADDRESSES.isV3Engine;
      const hasCreditScore = isV3
        ? await contract.hasCreditScore(address)
        : await contract.hasComputedScore(address);

      let score: number | null = null;
      let isDecrypted = false;
      let scoreComputedAt: number | null = null;
      let isScoreStale = false;
      let scoreHistoryLength = 0;
      let hasBorrowingPower = false;
      let scoreCtHash: string | null = null;

      if (hasCreditScore) {
        try {
          const [scoreVal, decrypted] = isV3
            ? await contract.getDecryptedScore(address)
            : await contract.getDecryptedScoreSafe();
          if (decrypted) {
            score = Number(scoreVal);
            isDecrypted = true;
          }
        } catch { /* not yet decrypted */ }

        if (isV3) {
          try {
            scoreComputedAt = Number(await contract.scoreComputedAt(address));
            isScoreStale = await contract.isScoreStale(address);
            scoreHistoryLength = Number(await contract.getScoreHistoryLength(address));
            hasBorrowingPower = await contract.hasBorrowingPower(address);
            // Read the latest ciphertext handle from score history
            if (scoreHistoryLength > 0) {
              const ctHash = await contract.getScoreHistoryAt(address, scoreHistoryLength - 1);
              scoreCtHash = `0x${BigInt(ctHash).toString(16).padStart(64, "0")}`;
            }
          } catch { /* V3 fields not available */ }
        }
      }

      const tierInfo = score !== null
        ? getRiskTierFromScore(score)
        : { tier: "Unknown", color: "text-muted-foreground", factor: 0 };

      setProfile({
        isRegistered: true,
        hasCreditScore,
        score,
        isDecrypted,
        riskTier: tierInfo.tier,
        riskColor: tierInfo.color,
        riskFactor: tierInfo.factor,
        scoreComputedAt,
        isScoreStale,
        scoreHistoryLength,
        hasBorrowingPower,
        scoreCtHash,
      });
    } catch (err: any) {
      console.error("loadProfile error:", err);
    }
  }, [address, getReadContract]);

  // ── register ──────────────────────────────────────────────────────────────
  const register = useCallback(async () => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.register();
      setTxHash(tx.hash);
      await tx.wait();
      await loadProfile();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadProfile]);

  // ── submitCreditData ─────────────────────────────────────────────────────
  // V1 path: sends raw uint256 values to SimpleCreditEngine.
  // V3 path: EncryptedCreditEngineV3 requires real InEuint* ciphertexts from
  //          the CoFHE SDK. Without the SDK, we skip data submission and go
  //          straight to computeCreditScore() — the contract operates on
  //          zero-initialized encrypted fields, producing a score of 300.
  //          This is the correct Wave 3 demo flow on Base Sepolia.
  const submitCreditData = useCallback(async (
    income: bigint,
    totalDebt: bigint,
    paymentHistory: number,
    creditUtilization: number,
    accountAge: number,
    numDefaults: number
  ) => {
    const contract = getContract();
    if (!contract) return;

    if (ADDRESSES.isV3Engine) {
      // V3: skip data submission (requires CoFHE SDK not available here)
      // and go straight to computeCreditScore(). The contract will compute
      // on zero-initialized encrypted fields → score = 300 (minimum).
      // Real FHE data submission uses submitCreditDataEncrypted() below.
      setLoading(true); setError(null); setTxHash(null);
      try {
        const tx = await contract.computeCreditScore();
        setTxHash(tx.hash);
        await tx.wait();
        await loadProfile();
      } catch (err: any) {
        setError(parseContractError(err));
      } finally { setLoading(false); }
      return;
    }

    setLoading(true); setError(null); setTxHash(null);
    try {
      // V1 SimpleCreditEngine — all params are plain uint256
      const tx = await contract.submitCreditData(
        income,
        totalDebt,
        BigInt(paymentHistory),
        BigInt(creditUtilization),
        BigInt(accountAge),
        BigInt(numDefaults)
      );
      setTxHash(tx.hash);
      await tx.wait();
      await loadProfile();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadProfile]);

  // ── submitCreditDataEncrypted — V3 EncryptedCreditEngineV3 (FHE ciphertexts) ─
  // Takes real CoFHE SDK EncryptedItemInput objects.
  //
  // Usage with @cofhe/sdk:
  //   const [encIncome, encDebt, encPH, encUtil, encAge, encDef] =
  //     await cofheClient
  //       .encryptInputs([
  //         Encryptable.uint64(income),
  //         Encryptable.uint64(totalDebt),
  //         Encryptable.uint32(BigInt(paymentHistory)),
  //         Encryptable.uint32(BigInt(creditUtilization)),
  //         Encryptable.uint32(BigInt(accountAge)),
  //         Encryptable.uint32(BigInt(numDefaults)),
  //       ])
  //       .execute();
  //
  //   await submitCreditDataEncrypted({
  //     income: encIncome, totalDebt: encDebt,
  //     paymentHistory: encPH, creditUtilization: encUtil,
  //     accountAge: encAge, numDefaults: encDef,
  //   });
  //
  // Each EncryptedItemInput = { ctHash: bigint, securityZone: number, utype: number, signature: string }
  // This maps directly to the Solidity InEuint* struct tuple.
  const submitCreditDataEncrypted = useCallback(async (inputs: EncryptedCreditInputs) => {
    if (!ADDRESSES.isV3Engine) {
      setError("submitCreditDataEncrypted() requires V3 engine. Set VITE_CREDIT_ENGINE_V3_ADDRESS.");
      return;
    }
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      // ethers.js serialises each CoFHEEncryptedInput as the tuple
      // (uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature)
      // matching the Solidity InEuint64/InEuint32 struct layout exactly.
      const tx = await contract.submitCreditData(
        inputs.income,
        inputs.totalDebt,
        inputs.paymentHistory,
        inputs.creditUtilization,
        inputs.accountAge,
        inputs.numDefaults
      );
      setTxHash(tx.hash);
      await tx.wait();
      await loadProfile();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadProfile]);

  // ── computeScore ──────────────────────────────────────────────────────────
  const computeScore = useCallback(async () => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.computeCreditScore();
      setTxHash(tx.hash);
      await tx.wait();
      await loadProfile();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadProfile]);

  // ── requestDecryption ─────────────────────────────────────────────────────
  // NOTE: FHE.decrypt() requires a CoFHE-enabled network (Fhenix Helium or
  // localcofhe). On Base Sepolia, this call will revert because the FHE
  // task manager is not deployed there. The function is kept for completeness
  // but the UI should not expose it on Base Sepolia.
  const requestDecryption = useCallback(async () => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      // On V3 + Base Sepolia: FHE.decrypt() reverts — task manager not deployed.
      // On V3 + Fhenix Helium / localcofhe: works correctly.
      // On V1 (SimpleCreditEngine): uses getDecryptedScoreSafe() which is a
      // plain view — no FHE network needed.
      if (ADDRESSES.isV3Engine) {
        setError(
          "FHE decryption requires a CoFHE-enabled network (Fhenix Helium or localcofhe). " +
          "Base Sepolia does not have the FHE task manager deployed. " +
          "Your score is stored as an encrypted ciphertext handle on-chain."
        );
        setLoading(false);
        return;
      }
      const tx = await contract.requestScoreDecryption();
      setTxHash(tx.hash);
      await tx.wait();
      await loadProfile();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadProfile]);

  // ── computeBorrowingPower (V3 only) ───────────────────────────────────────
  const computeBorrowingPower = useCallback(async () => {
    if (!ADDRESSES.isV3Engine) return;
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.computeBorrowingPower();
      setTxHash(tx.hash);
      await tx.wait();
      await loadProfile();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadProfile]);

  // ── grantScoreAccess (V3 only) ────────────────────────────────────────────
  const grantScoreAccess = useCallback(async (recipient: string) => {
    if (!ADDRESSES.isV3Engine) return;
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.grantScoreAccess(recipient);
      setTxHash(tx.hash);
      await tx.wait();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract]);

  return {
    profile,
    loading,
    error,
    txHash,
    loadProfile,
    register,
    // V1 plaintext path (live Base Sepolia)
    submitCreditData,
    // V3 FHE path — requires CoFHE SDK encrypted inputs
    submitCreditDataEncrypted,
    computeScore,
    requestDecryption,
    computeBorrowingPower,
    grantScoreAccess,
    clearError: () => setError(null),
    isV3: ADDRESSES.isV3Engine,
  };
}
