import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet";
import { getMultiAssetLoanPoolContract, parseContractError, ADDRESSES } from "@/lib/contracts";

export interface AssetInfo {
  address: string;
  enabled: boolean;
  decimals: number;
  symbol: string;
  priceUsd18: bigint;
  totalLiquidity: bigint;
  totalLoanedOut: bigint;
  totalInterest: bigint;
}

export interface MultiPoolState {
  assetCount: number;
  assets: AssetInfo[];
}

export interface MultiLoan {
  id: number;
  borrower: string;
  token: string;
  tokenSymbol: string;
  principal: bigint;
  totalOwed: bigint;
  repaidAmount: bigint;
  dueDate: bigint;
  status: number;
  statusLabel: string;
  isOverdue: boolean;
  collateralToken: string;
  collateralAmount: bigint;
  collateralPosted: boolean;
  approvalResolved: boolean;
  approvalPassed: boolean;
}

export interface PoolConfig {
  baseInterestRate: bigint;
  maxDuration: bigint;
  minCreditScore: bigint;
  minLoanAmount: bigint;
  maxLoanAmount: bigint;
}

const DEFAULT_STATE: MultiPoolState = {
  assetCount: 0,
  assets: [],
};

export function useMultiAssetPool() {
  const { signer, provider, address } = useWallet();
  const [poolState, setPoolState] = useState<MultiPoolState>(DEFAULT_STATE);
  const [loans, setLoans] = useState<MultiLoan[]>([]);
  const [lenderDeposits, setLenderDeposits] = useState<Record<string, { amount: bigint; depositedAt: number }>>({});
  const [lenderYields, setLenderYields] = useState<Record<string, bigint>>({});
  const [poolConfigs, setPoolConfigs] = useState<Record<number, PoolConfig>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const tokenSymbols = useCallback(async (contract: ethers.Contract, token: string) => {
    try {
      const asset = await contract.assets(token);
      return asset.symbol;
    } catch {
      return token.slice(0, 6);
    }
  }, []);

  const getReadContract = useCallback(() => {
    if (!provider) return null;
    return getMultiAssetLoanPoolContract(provider);
  }, [provider]);

  const getWriteContract = useCallback(() => {
    if (!signer) return null;
    return getMultiAssetLoanPoolContract(signer);
  }, [signer]);

  const loadPoolState = useCallback(async () => {
    const contract = getReadContract();
    if (!contract) return;
    try {
      const assetCount = Number(await contract.getAssetCount());

      // Parallel: fetch all asset details concurrently
      const assets: AssetInfo[] = await Promise.all(
        Array.from({ length: assetCount }, async (_, i) => {
          const tokenAddr: string = await contract.assetList(i);
          const cfg = await contract.assets(tokenAddr);
          return {
            address: tokenAddr,
            enabled: cfg.enabled,
            decimals: Number(cfg.decimals),
            symbol: cfg.symbol,
            priceUsd18: cfg.priceUsd18,
            totalLiquidity: cfg.totalLiquidity,
            totalLoanedOut: cfg.totalLoanedOut,
            totalInterest: cfg.totalInterest,
          };
        })
      );

      // Parallel: load pool configs (3 risk tiers)
      const cfgs: Record<number, PoolConfig> = {};
      const poolResults = await Promise.all(
        [0, 1, 2].map(i => contract.poolConfigs(i).then((c: any) => ({ i, c })).catch(() => null))
      );
      for (const r of poolResults) {
        if (r) {
          cfgs[r.i] = {
            baseInterestRate: r.c.baseInterestRate,
            maxDuration: r.c.maxDuration,
            minCreditScore: r.c.minCreditScore,
            minLoanAmount: r.c.minLoanAmount,
            maxLoanAmount: r.c.maxLoanAmount,
          };
        }
      }
      setPoolConfigs(cfgs);

      let pcPaused = false;
      try { pcPaused = await contract.paused(); } catch {}
      setPaused(pcPaused);

      // Parallel: load lender deposits + yields for each asset
      if (address && assets.length > 0) {
        const results = await Promise.all(
          assets.map(async (asset) => {
            const [depAmt, depAt] = await contract.getLenderDeposit(asset.address, address).catch(() => [0n, 0n]);
            const yieldAmt = await contract.lenderYieldEarned(asset.address, address).catch(() => 0n);
            return { addr: asset.address, depAmt, depAt, yieldAmt };
          })
        );
        const deposits: Record<string, { amount: bigint; depositedAt: number }> = {};
        const yields: Record<string, bigint> = {};
        for (const r of results) {
          if (r.depAmt > 0n) deposits[r.addr] = { amount: r.depAmt, depositedAt: Number(r.depAt) };
          if (r.yieldAmt > 0n) yields[r.addr] = r.yieldAmt;
        }
        setLenderDeposits(deposits);
        setLenderYields(yields);
      }

      setPoolState({ assetCount, assets });
    } catch (err: any) {
      console.error("loadMultiPoolState error:", err);
    }
  }, [address, getReadContract]);

  const loadLoans = useCallback(async () => {
    if (!address) return;
    const contract = getReadContract();
    if (!contract) return;
    try {
      const ids: bigint[] = await contract.getBorrowerLoans(address);
      const now = Math.floor(Date.now() / 1000);

      // Build symbol cache
      const symbolCache: Record<string, string> = {};
      for (const a of poolState.assets) symbolCache[a.address] = a.symbol;

      const loaded = await Promise.all(
        ids.map(async (id) => {
          const loan = await contract.getLoan(id);
          const token = loan[1] ?? loan.token;
          let sym = symbolCache[token];
          if (!sym) {
            try {
              const asset = await contract.assets(token);
              sym = asset.symbol;
              symbolCache[token] = sym;
            } catch { sym = token.slice(0, 6); }
          }
          return {
            id: Number(id),
            borrower: loan[0] ?? loan.borrower,
            token,
            tokenSymbol: sym,
            principal: BigInt(loan[2] ?? loan.principal),
            totalOwed: BigInt(loan[3] ?? loan.totalOwed),
            repaidAmount: BigInt(loan[4] ?? loan.repaidAmount),
            dueDate: BigInt(loan[5] ?? loan.dueDate ?? 0),
            status: Number(loan[6] ?? loan.status),
            statusLabel: ["Pending", "Active", "Repaid", "Defaulted"][Number(loan[6] ?? loan.status)] ?? "Unknown",
            isOverdue: Number(loan[6] ?? loan.status) === 1 && Number(loan[5] ?? loan.dueDate ?? 0) > 0 && Number(loan[5] ?? loan.dueDate ?? 0) < now,
            collateralToken: loan[7] ?? loan.collateralToken ?? ethers.ZeroAddress,
            collateralAmount: BigInt(loan[8] ?? loan.collateralAmount ?? 0),
            collateralPosted: Boolean(loan[9] ?? loan.collateralPosted ?? false),
            approvalResolved: false,
            approvalPassed: false,
          } as MultiLoan;
        })
      );
      setLoans(loaded);
    } catch (err: any) {
      console.error("loadMultiLoans error:", err);
    }
  }, [address, getReadContract, poolState.assets]);

  // ── Lender txs ────────────────────────────────────────────────────────────
  const getDecimals = useCallback((token: string) => {
    const asset = poolState.assets.find(a => a.address === token);
    return asset?.decimals ?? 18;
  }, [poolState.assets]);

  const ensureAllowance = useCallback(async (token: string, amount: bigint) => {
    if (!signer || !address || !ADDRESSES.multiAssetPool) return;
    const erc20 = new ethers.Contract(token, [
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ], signer);
    const currentAllowance = await erc20.allowance(address, ADDRESSES.multiAssetPool);
    if (currentAllowance < amount) {
      const tx = await erc20.approve(ADDRESSES.multiAssetPool, amount);
      await tx.wait();
    }
  }, [signer, address]);

  const fundPool = useCallback(async (token: string, amount: string) => {
    const contract = getWriteContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const decimals = getDecimals(token);
      const parsed = ethers.parseUnits(amount, decimals);
      await ensureAllowance(token, parsed);
      const tx = await contract.fundPool(token, parsed);
      setTxHash(tx.hash);
      await tx.wait();
      await loadPoolState();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getWriteContract, getDecimals, ensureAllowance, loadPoolState]);

  const withdrawFunds = useCallback(async (token: string, amount: string) => {
    const contract = getWriteContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const decimals = getDecimals(token);
      const parsed = ethers.parseUnits(amount, decimals);
      const tx = await contract.withdrawFunds(token, parsed);
      setTxHash(tx.hash);
      await tx.wait();
      await loadPoolState();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getWriteContract, getDecimals, loadPoolState]);

  const claimYield = useCallback(async (token: string) => {
    const contract = getWriteContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.claimYield(token);
      setTxHash(tx.hash);
      await tx.wait();
      await loadPoolState();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getWriteContract, loadPoolState]);

  // ── Borrower txs ──────────────────────────────────────────────────────────
  const requestLoan = useCallback(async (
    token: string,
    principal: string,
    durationDays: number,
    riskPool: number,
    collateralToken: string,
    collateralAmount: string,
  ) => {
    const contract = getWriteContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const decimals = getDecimals(token);
      const principalParsed = ethers.parseUnits(principal, decimals);
      const collatParsed = collateralToken && collateralAmount
        ? ethers.parseUnits(collateralAmount, getDecimals(collateralToken))
        : 0n;
      const durationSecs = durationDays * 24 * 60 * 60;
      const tx = await contract.requestLoan(
        token, principalParsed, durationSecs, riskPool,
        collateralToken || ethers.ZeroAddress, collatParsed,
      );
      setTxHash(tx.hash);
      await tx.wait();
      await Promise.all([loadPoolState(), loadLoans()]);
    } catch (err: any) {
      // BelowMinimum fires when principalUsd < config.minLoanAmount
      // The min is in USD — make the message actionable
      const raw = parseContractError(err);
      if (raw.includes("BelowMinimum") || raw.includes("Below")) {
        setError("Amount is below the pool minimum (in USD value). Increase the amount or switch to a lower-tier pool.");
      } else       if (raw.includes("NoCreditScore")) {
        setError("No credit score found — compute your score on the Submit Data page first.");
      } else if (raw.includes("NoCreditData")) {
        setError("No credit score data found — compute your score on the Submit Data page first.");
      } else if (raw.includes("NotRegistered")) {
        setError("Not registered — register your wallet on the Submit Data page first.");
      } else if (raw.includes("StaleScore")) {
        setError("Credit score is stale (180+ days) — recompute your score first.");
      } else if (raw.includes("AssetNotWhitelisted")) {
        setError("This asset is not whitelisted for collateral.");
      } else if (raw.includes("InsufficientLiquidity")) {
        setError("This asset has no available liquidity — fund the pool first or switch to a different asset.");
      } else if (raw.includes("BelowMinimum") || raw.includes("Below")) {
        setError("Amount is below the pool minimum (in USD value). Increase the amount or switch to a lower-tier pool.");
      } else {
        setError(raw);
      }
    } finally { setLoading(false); }
  }, [getWriteContract, loadPoolState, loadLoans]);

  const resolveLoanApproval = useCallback(async (loanId: number) => {
    const contract = getWriteContract();
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
  }, [getWriteContract, loadLoans]);

  const repayLoan = useCallback(async (loanId: number, amount: string, token: string) => {
    const contract = getWriteContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const decimals = getDecimals(token);
      const parsed = ethers.parseUnits(amount, decimals);
      await ensureAllowance(token, parsed);
      const tx = await contract.repayLoan(loanId, parsed);
      setTxHash(tx.hash);
      await tx.wait();
      await Promise.all([loadPoolState(), loadLoans()]);
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getWriteContract, loadPoolState, loadLoans]);

  const markDefaulted = useCallback(async (loanId: number) => {
    const contract = getWriteContract();
    if (!contract) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await contract.markDefaulted(loanId);
      setTxHash(tx.hash);
      await tx.wait();
      await loadLoans();
    } catch (err: any) {
      setError(parseContractError(err));
    } finally { setLoading(false); }
  }, [getWriteContract, loadLoans]);

  return {
    poolState,
    loans,
    lenderDeposits,
    lenderYields,
    poolConfigs,
    loading,
    error,
    txHash,
    paused,
    loadPoolState,
    loadLoans,
    fundPool,
    withdrawFunds,
    claimYield,
    requestLoan,
    resolveLoanApproval,
    repayLoan,
    markDefaulted,
    clearError: () => setError(null),
    hasAddress: !!ADDRESSES.multiAssetPool,
  };
}
