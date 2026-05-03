import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet";
import { getLoanPoolContract, parseContractError, getLoanStatusLabel, ADDRESSES } from "@/lib/contracts";

// CoFHE-enabled networks — FHE.gte() / FHE.decrypt() only work here
const COFHE_CHAIN_IDS = new Set([8008135, 412346]); // Fhenix Helium, localcofhe

export interface PoolState {
  totalLiquidity: bigint;
  availableLiquidity: bigint;
  totalLoanedOut: bigint;
  totalInterestCollected: bigint;  // V3 only
  loanCount: number;
  lenderDeposit: bigint;
  lenderYieldEarned: bigint;       // V3 only
  depositedAt: number;
}

export interface Loan {
  id: number;
  borrower: string;
  principal: bigint;
  totalOwed: bigint;
  repaidAmount: bigint;
  interestRate: bigint;
  dueDate: bigint;
  status: number;
  statusLabel: string;
  isOverdue: boolean;
  // V3 approval tracking
  approvalResolved: boolean;
  approvalPassed: boolean;
  checkId: string;
  eboolCtHash: bigint;
}

const DEFAULT_POOL: PoolState = {
  totalLiquidity: 0n,
  availableLiquidity: 0n,
  totalLoanedOut: 0n,
  totalInterestCollected: 0n,
  loanCount: 0,
  lenderDeposit: 0n,
  lenderYieldEarned: 0n,
  depositedAt: 0,
};

export function useLoanPool() {
  const { signer, provider, address, chainId } = useWallet();
  const isFHENetwork = chainId !== null && COFHE_CHAIN_IDS.has(chainId);
  const [poolState, setPoolState] = useState<PoolState>(DEFAULT_POOL);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const getContract = useCallback(() => {
    if (!signer) return null;
    return getLoanPoolContract(signer);
  }, [signer]);

  const getReadContract = useCallback(() => {
    if (!provider) return null;
    return getLoanPoolContract(provider);
  }, [provider]);

  // ── Load pool state ───────────────────────────────────────────────────────
  const loadPoolState = useCallback(async () => {
    const contract = getReadContract();
    if (!contract) return;
    try {
      const [totalLiquidity, availableLiquidity, loanCount] = await Promise.all([
        contract.totalPoolLiquidity(),
        contract.getAvailableLiquidity(),
        contract.loanCount(),
      ]);

      let totalLoanedOut = 0n;
      let totalInterestCollected = 0n;
      let lenderDeposit = 0n;
      let lenderYieldEarned = 0n;
      let depositedAt = 0;

      try { totalLoanedOut = await contract.totalLoanedOut(); } catch {}

      if (ADDRESSES.isV3Pool) {
        try { totalInterestCollected = await contract.totalInterestCollected(); } catch {}
      }

      if (address) {
        try {
          const [dep, depAt] = await contract.getLenderDeposit(address);
          lenderDeposit = dep;
          depositedAt = Number(depAt);
        } catch {}
        if (ADDRESSES.isV3Pool) {
          try { lenderYieldEarned = await contract.lenderYieldEarned(address); } catch {}
        }
      }

      setPoolState({
        totalLiquidity,
        availableLiquidity,
        totalLoanedOut,
        totalInterestCollected,
        loanCount: Number(loanCount),
        lenderDeposit,
        lenderYieldEarned,
        depositedAt,
      });
    } catch (err: any) {
      console.error("loadPoolState error:", err);
    }
  }, [address, getReadContract]);

  // ── Load user loans ───────────────────────────────────────────────────────
  const loadLoans = useCallback(async () => {
    if (!address) return;
    const contract = getReadContract();
    if (!contract) return;
    try {
      const ids: bigint[] = await contract.getBorrowerLoans(address);
      const now = Math.floor(Date.now() / 1000);

      const loaded = await Promise.all(
        ids.map(async (id) => {
          const loan = await contract.getLoan(id);
          const status = Number(loan[6] ?? loan.status);
          const dueDate = BigInt(loan[5] ?? loan.dueDate ?? 0);

          let approvalResolved = false;
          let approvalPassed = false;
          let checkId = ethers.ZeroHash;
          let eboolCtHash = 0n;

          if (ADDRESSES.isV3Pool) {
            try {
              const approval = await contract.getLoanApprovalStatus(id);
              approvalResolved = approval[0];
              approvalPassed = approval[1];
              checkId = approval[2];
              eboolCtHash = BigInt(approval[3] ?? 0);
            } catch {}
          }

          return {
            id: Number(id),
            borrower: loan[0] ?? loan.borrower,
            principal: BigInt(loan[1] ?? loan.principal),
            totalOwed: BigInt(loan[2] ?? loan.totalOwed),
            repaidAmount: BigInt(loan[3] ?? loan.repaidAmount),
            interestRate: BigInt(loan[4] ?? loan.interestRate),
            dueDate,
            status,
            statusLabel: getLoanStatusLabel(status),
            isOverdue: status === 1 && Number(dueDate) > 0 && Number(dueDate) < now,
            approvalResolved,
            approvalPassed,
            checkId,
            eboolCtHash,
          } as Loan;
        })
      );
      setLoans(loaded);
    } catch (err: any) {
      console.error("loadLoans error:", err);
    }
  }, [address, getReadContract]);

  // ── Transactions ──────────────────────────────────────────────────────────
  const fundPool = useCallback(async (amountEth: string) => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.fundPool({ value: ethers.parseEther(amountEth) });
      setTxHash(tx.hash);
      await tx.wait();
      await loadPoolState();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadPoolState]);

  const withdrawFunds = useCallback(async (amountEth: string) => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.withdrawFunds(ethers.parseEther(amountEth));
      setTxHash(tx.hash);
      await tx.wait();
      await loadPoolState();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadPoolState]);

  // V3: claim accrued yield
  const claimYield = useCallback(async () => {
    if (!ADDRESSES.isV3Pool) return;
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.claimYield();
      setTxHash(tx.hash);
      await tx.wait();
      await loadPoolState();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadPoolState]);

  const requestLoan = useCallback(async (
    principalEth: string,
    durationDays: number,
    riskPool: number  // 0=Conservative, 1=Moderate, 2=Aggressive
  ) => {
    // V3 requestLoan calls creditEngine.requestApprovalCheck() which calls
    // FHE.gte() — this requires the CoFHE task manager. On Base Sepolia it
    // reverts immediately. Block it here before the wallet popup fires.
    if (ADDRESSES.isV3Pool && !isFHENetwork) {
      setError(
        "V3 loan approval uses FHE.gte() which requires a CoFHE-enabled network " +
        "(Fhenix Helium or localcofhe). On Base Sepolia the transaction will revert. " +
        "To demo borrowing: switch to Fhenix Helium, or fund and borrow on the Wave 1 pool " +
        "at 0x0A2AB73CB8311aFD261Ab92137ff70E9Ca268d69 which uses plaintext approval."
      );
      return;
    }
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const durationSecs = durationDays * 24 * 60 * 60;
      const tx = await contract.requestLoan(ethers.parseEther(principalEth), durationSecs, riskPool);
      setTxHash(tx.hash);
      await tx.wait();
      await Promise.all([loadPoolState(), loadLoans()]);
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadPoolState, loadLoans, isFHENetwork]);

  // V3: poll FHE approval result — call repeatedly until ready
  const resolveLoanApproval = useCallback(async (loanId: number) => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.resolveLoanApproval(loanId);
      setTxHash(tx.hash);
      await tx.wait();
      await loadLoans();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadLoans]);

  const repayLoan = useCallback(async (loanId: number, amountEth: string) => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.repayLoan(loanId, { value: ethers.parseEther(amountEth) });
      setTxHash(tx.hash);
      await tx.wait();
      await Promise.all([loadPoolState(), loadLoans()]);
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadPoolState, loadLoans]);

  // V3: refinance an active loan
  const refinanceLoan = useCallback(async (loanId: number, newPool: number) => {
    if (!ADDRESSES.isV3Pool) return;
    const contract = getContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.refinanceLoan(loanId, newPool);
      setTxHash(tx.hash);
      await tx.wait();
      await Promise.all([loadPoolState(), loadLoans()]);
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getContract, loadPoolState, loadLoans]);

  return {
    poolState,
    loans,
    loading,
    error,
    txHash,
    loadPoolState,
    loadLoans,
    fundPool,
    withdrawFunds,
    claimYield,
    requestLoan,
    resolveLoanApproval,
    repayLoan,
    refinanceLoan,
    clearError: () => setError(null),
    isV3: ADDRESSES.isV3Pool,
    isFHENetwork,
  };
}
