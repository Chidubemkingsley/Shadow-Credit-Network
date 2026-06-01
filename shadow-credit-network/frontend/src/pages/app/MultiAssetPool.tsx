import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet";
import { useMultiAssetPool, AssetInfo, MultiLoan } from "@/hooks/useMultiAssetPool";
import { useCreditEngine } from "@/hooks/useCreditEngine";
import {
  AlertTriangle, CheckCircle2, Loader2, RefreshCw,
  TrendingUp, ArrowRight, Clock, Shield, DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";

const POOLS = [
  { id: 0, name: "Conservative", apr: "3%",  minScore: 740, maxDays: 90,  color: "border-success/30 bg-success/5",         badge: "text-success" },
  { id: 1, name: "Moderate",     apr: "8%",  minScore: 670, maxDays: 180, color: "border-warning/30 bg-warning/5",         badge: "text-warning" },
  { id: 2, name: "Aggressive",   apr: "15%", minScore: 580, maxDays: 365, color: "border-destructive/30 bg-destructive/5", badge: "text-destructive" },
];

function StatusBadge({ status, label }: { status: number; label: string }) {
  return (
    <span className={cn(
      "text-xs px-2 py-0.5 rounded-full font-semibold",
      status === 0 ? "bg-muted text-muted-foreground" :
      status === 1 ? "bg-primary/10 text-primary" :
      status === 2 ? "bg-success/10 text-success" :
      "bg-destructive/10 text-destructive"
    )}>
      {label}
    </span>
  );
}

export default function MultiAssetPool() {
  const { isConnected, address } = useWallet();
  const {
    poolState, loans, lenderDeposits, lenderYields, poolConfigs,
    loading, error, txHash, paused,
    loadPoolState, loadLoans,
    fundPool, withdrawFunds, claimYield,
    requestLoan, resolveLoanApproval, repayLoan, markDefaulted,
    clearError, hasAddress,
  } = useMultiAssetPool();
  const { profile, loadProfile } = useCreditEngine();

  // Form state
  const [activeTab, setActiveTab] = useState("lend");
  const [selectedAsset, setSelectedAsset] = useState<string>("");
  const [fundAmount, setFundAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [loanDays, setLoanDays] = useState("30");
  const [selectedPool, setSelectedPool] = useState(2); // default Aggressive — lowest minimum
  const [collateralToken, setCollateralToken] = useState("");
  const [collateralAmount, setCollateralAmount] = useState("");
  const [repayId, setRepayId] = useState<number | null>(null);
  const [repayAmount, setRepayAmount] = useState("");

  useEffect(() => {
    if (isConnected && address) {
      loadPoolState(); loadLoans(); loadProfile();
    }
  }, [isConnected, address]);

  useEffect(() => {
    if (poolState.assets.length > 0 && !selectedAsset) {
      const firstEnabled = poolState.assets.find(a => a.enabled) ?? poolState.assets[0];
      setSelectedAsset(firstEnabled.address);
    }
  }, [poolState.assets, selectedAsset]);

  const currentAsset = poolState.assets.find((a) => a.address === selectedAsset);
  const currentDeposit = selectedAsset ? lenderDeposits[selectedAsset] : undefined;
  const currentYield = selectedAsset ? (lenderYields[selectedAsset] ?? 0n) : 0n;
  const activeLoans = loans.filter((l) => l.status === 1);
  const pendingLoans = loans.filter((l) => l.status === 0);

  // Compute minimum loan amount in token units for the selected pool + asset
  const minLoanInTokens = (() => {
    const cfg = poolConfigs[selectedPool];
    if (!cfg || !currentAsset || currentAsset.priceUsd18 === 0n) return 0;
    // minLoanAmount is in USD with 18 decimals
    // tokenAmount = minUsd * 10^decimals / priceUsd18
    const minUsd = cfg.minLoanAmount; // e.g. 10e18 for $10
    const price = currentAsset.priceUsd18; // e.g. 1e18 for $1 USDC
    const decimals = currentAsset.decimals;
    // tokenAmount = minUsd / price * 10^decimals
    const tokenAmountRaw = (minUsd * BigInt(10 ** decimals)) / price;
    return Number(ethers.formatUnits(tokenAmountRaw, decimals));
  })();

  // Auto-set loan amount to minimum when asset or pool changes
  useEffect(() => {
    if (minLoanInTokens > 0) {
      setLoanAmount(minLoanInTokens.toFixed(currentAsset?.decimals === 6 ? 2 : 4));
    }
  }, [selectedAsset, selectedPool, minLoanInTokens]);

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass rounded-2xl p-12 text-center space-y-4">
          <div className="text-4xl">🏦</div>
          <h2 className="text-2xl font-bold font-heading">Connect Your Wallet</h2>
          <p className="text-muted-foreground">Connect to Arbitrum Sepolia to access the multi-asset pool.</p>
        </div>
      </div>
    );
  }

  if (!hasAddress) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass rounded-2xl p-12 text-center space-y-4">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-2xl font-bold font-heading">Multi-Asset Pool Not Deployed</h2>
          <p className="text-muted-foreground">The MultiAssetLoanPool contract address is not configured.</p>
        </div>
      </div>
    );
  }

  const handleFund = () => {
    if (!selectedAsset || !fundAmount) return;
    fundPool(selectedAsset, fundAmount);
  };

  const handleWithdraw = () => {
    if (!selectedAsset || !withdrawAmount) return;
    withdrawFunds(selectedAsset, withdrawAmount);
  };

  const handleClaimYield = () => {
    if (!selectedAsset) return;
    claimYield(selectedAsset);
  };

  const handleRequestLoan = async () => {
    if (!selectedAsset) return;
    await requestLoan(
      selectedAsset, loanAmount, Number(loanDays), selectedPool,
      collateralToken, collateralAmount,
    );
    setActiveTab("loans");
  };

  const handleRepay = (loan: MultiLoan) => {
    if (!repayAmount) return;
    repayLoan(loan.id, repayAmount, loan.token);
    setRepayId(null);
    setRepayAmount("");
  };

  const availableAsset = currentAsset
    ? Number(ethers.formatUnits(
        currentAsset.totalLiquidity - currentAsset.totalLoanedOut,
        currentAsset.decimals,
      ))
    : 0;

  const depositFmt = currentDeposit && currentAsset
    ? Number(ethers.formatUnits(currentDeposit.amount, currentAsset.decimals)).toFixed(4)
    : "0.0000";

  const yieldFmt = currentYield && currentAsset
    ? Number(ethers.formatUnits(currentYield, currentAsset.decimals)).toFixed(6)
    : "0.000000";

  const assetBalance = currentAsset
    ? Number(ethers.formatUnits(currentAsset.totalLiquidity, currentAsset.decimals)).toFixed(4)
    : "0.0000";

  const loanBalance = currentAsset
    ? Number(ethers.formatUnits(currentAsset.totalLoanedOut, currentAsset.decimals)).toFixed(4)
    : "0.0000";

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-heading">Multi-Asset Pool</h1>
          <p className="text-muted-foreground mt-1">
            ERC-20 collateralized lending — LTV-adjusted credit scores, per-asset yield
          </p>
        </div>
        <div className="flex items-center gap-2">
          {paused && (
            <span className="text-xs flex items-center gap-1 px-2 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/30">
              <AlertTriangle className="w-3 h-3" /> Paused
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => { loadPoolState(); loadLoans(); }} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Asset selector */}
      {poolState.assets.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center">
          <DollarSign className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">No assets whitelisted yet.</p>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {poolState.assets.map((asset) => (
            <button
              key={asset.address}
              onClick={() => setSelectedAsset(asset.address)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                selectedAsset === asset.address
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-muted border-border text-muted-foreground hover:text-foreground",
                !asset.enabled && "opacity-50",
              )}
            >
              {asset.symbol}
              {!asset.enabled && " (disabled)"}
            </button>
          ))}
        </div>
      )}

      {/* Asset stats */}
      {currentAsset && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Pool Balance",  value: `${assetBalance} ${currentAsset.symbol}` },
            { label: "Loaned Out",    value: `${loanBalance} ${currentAsset.symbol}`, color: "text-primary" },
            { label: "Available",     value: `${availableAsset.toFixed(4)} ${currentAsset.symbol}`, color: "text-success" },
            { label: "Your Deposit",  value: `${depositFmt} ${currentAsset.symbol}` },
            { label: "Your Yield",    value: `${yieldFmt} ${currentAsset.symbol}`, color: "text-warning" },
          ].map((s) => (
            <div key={s.label} className="glass rounded-xl p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className={cn("text-lg font-bold font-heading mt-0.5 truncate", s.color ?? "")}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Error / tx */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="glass rounded-xl p-4 border border-destructive/30 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 text-sm text-destructive">{error}</div>
            <button onClick={clearError} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </motion.div>
        )}
        {txHash && !error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="glass rounded-xl p-3 border border-success/30 flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="w-4 h-4" />
            Transaction confirmed:
            <a href={`https://sepolia.arbiscan.io/tx/${txHash}`} target="_blank" rel="noreferrer"
              className="underline font-mono text-primary">{txHash.slice(0, 20)}…</a>
          </motion.div>
        )}
      </AnimatePresence>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted">
          <TabsTrigger value="lend">Lend</TabsTrigger>
          <TabsTrigger value="borrow">Borrow</TabsTrigger>
          <TabsTrigger value="loans">
            My Loans
            {loans.length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                {loans.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Lend ── */}
        <TabsContent value="lend" className="space-y-6 mt-6">
          {currentYield > 0n && currentAsset && (
            <div className="glass rounded-2xl p-5 border border-success/20 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Accrued Yield</div>
                <div className="text-2xl font-bold font-heading text-success mt-0.5">{yieldFmt} {currentAsset.symbol}</div>
                <div className="text-xs text-muted-foreground mt-1">From proportional interest distribution</div>
              </div>
              <Button className="bg-success/10 text-success hover:bg-success/20 border border-success/30 gap-2"
                onClick={handleClaimYield} disabled={loading}>
                <TrendingUp className="w-4 h-4" />
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Claim Yield"}
              </Button>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="glass rounded-2xl p-6 space-y-3">
              <h3 className="font-heading font-semibold">Fund Pool</h3>
              <p className="text-xs text-muted-foreground">
                Deposit {currentAsset?.symbol ?? "tokens"} to earn yield from borrower interest.
              </p>
              <Input type="number" placeholder={`Amount in ${currentAsset?.symbol ?? "tokens"}`}
                value={fundAmount} onChange={(e) => setFundAmount(e.target.value)}
                className="bg-muted" min="0" step="0.01" />
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={loading || !selectedAsset || !fundAmount} onClick={handleFund}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Fund Pool
              </Button>
            </div>

            <div className="glass rounded-2xl p-6 space-y-3">
              <h3 className="font-heading font-semibold">Withdraw</h3>
              <p className="text-xs text-muted-foreground">
                Your deposit: <span className="text-foreground font-semibold">{depositFmt} {currentAsset?.symbol ?? ""}</span>
              </p>
              <Input type="number" placeholder={`Max: ${depositFmt}`}
                value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
                className="bg-muted" min="0" step="0.01" />
              <Button variant="outline" className="w-full"
                disabled={loading || !withdrawAmount || !currentDeposit}
                onClick={handleWithdraw}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Withdraw
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ── Borrow ── */}
        <TabsContent value="borrow" className="space-y-4 mt-6">
          {profile.isScoreStale && (
            <div className="glass rounded-xl p-3 border border-warning/30 flex items-center gap-2 text-xs text-warning">
              <AlertTriangle className="w-4 h-4" />
              Your credit score is stale (180+ days). Recompute before requesting a loan.
            </div>
          )}

          {/* Pool selector */}
          <div className="grid md:grid-cols-3 gap-4">
            {POOLS.map((pool) => (
              <motion.div key={pool.id} whileHover={{ scale: 1.02 }}
                onClick={() => setSelectedPool(pool.id)}
                className={cn("glass rounded-2xl p-5 border cursor-pointer transition-all",
                  pool.color, selectedPool === pool.id && "ring-2 ring-primary")}>
                <h3 className="font-heading font-bold mb-3">{pool.name}</h3>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">APR</span>
                    <span className={cn("font-bold", pool.badge)}>{pool.apr}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Min Score</span>
                    <span>{poolConfigs[pool.id] ? poolConfigs[pool.id].minCreditScore.toString() : pool.minScore}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Duration</span>
                    <span>{pool.maxDays}d</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Loan form */}
          <div className="glass rounded-2xl p-6 space-y-4">
            <h3 className="font-heading font-semibold">
              Request Loan — {POOLS[selectedPool].name} Pool
            </h3>

            {/* USD minimum info banner */}
            {poolConfigs[selectedPool] && (
              <div className="glass rounded-lg p-3 border border-primary/10 text-xs text-muted-foreground flex items-center gap-2">
                <DollarSign className="w-3 h-3 text-primary shrink-0" />
                Min loan: <span className="text-foreground font-semibold">
                  ${Number(ethers.formatEther(poolConfigs[selectedPool].minLoanAmount)).toFixed(0)} USD
                </span>
                {currentAsset && (
                  <span>
                    = {minLoanInTokens.toFixed(currentAsset.decimals === 6 ? 2 : 4)} {currentAsset.symbol}
                  </span>
                )}
                · Max: <span className="text-foreground font-semibold">
                  ${Number(ethers.formatEther(poolConfigs[selectedPool].maxLoanAmount)).toLocaleString()} USD
                </span>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">
                  Amount ({currentAsset?.symbol ?? "tokens"})
                  {minLoanInTokens > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground/70">
                      — min {minLoanInTokens.toFixed(currentAsset?.decimals === 6 ? 2 : 4)}
                    </span>
                  )}
                </label>
                <Input type="number"
                  placeholder={minLoanInTokens > 0 ? `Min: ${minLoanInTokens.toFixed(currentAsset?.decimals === 6 ? 2 : 4)}` : `Max: ${availableAsset.toFixed(4)}`}
                  value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)}
                  className="bg-muted" min={minLoanInTokens > 0 ? minLoanInTokens : 0} step="0.01" />
                {loanAmount && minLoanInTokens > 0 && Number(loanAmount) < minLoanInTokens && (
                  <p className="text-xs text-destructive">
                    Below minimum — need at least {minLoanInTokens.toFixed(currentAsset?.decimals === 6 ? 2 : 4)} {currentAsset?.symbol}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">
                  Duration (days, max {POOLS[selectedPool].maxDays})
                </label>
                <Input type="number" value={loanDays} onChange={(e) => setLoanDays(e.target.value)}
                  className="bg-muted" min="1" max={POOLS[selectedPool].maxDays} />
              </div>
            </div>

            {/* Collateral section */}
            <div className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Collateral (optional)</span>
                <span className="text-xs text-muted-foreground">
                  — Reduces effective min credit score (50%+ LTV → −50, 25%+ LTV → −25)
                </span>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Collateral Token</label>
                  <select value={collateralToken}
                    onChange={(e) => setCollateralToken(e.target.value)}
                    className="w-full h-9 bg-muted border border-border rounded-lg px-3 text-sm">
                    <option value="">None</option>
                    {poolState.assets.filter((a) => a.address !== selectedAsset).map((a) => (
                      <option key={a.address} value={a.address}>{a.symbol}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Collateral Amount</label>
                  <Input type="number" placeholder="0" min="0" step="0.01"
                    value={collateralAmount} onChange={(e) => setCollateralAmount(e.target.value)}
                    className="bg-muted" disabled={!collateralToken} />
                </div>
              </div>
            </div>

            {!profile.hasCreditScore && (
              <div className="text-xs text-warning flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                You need a computed credit score to request a loan.
              </div>
            )}

            <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              disabled={
                loading || !loanAmount || availableAsset === 0 ||
                !profile.hasCreditScore || !selectedAsset ||
                (minLoanInTokens > 0 && Number(loanAmount) < minLoanInTokens)
              }
              onClick={handleRequestLoan}>
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirming in wallet…</>
                : !profile.hasCreditScore
                ? "Compute Credit Score First"
                : availableAsset === 0
                ? "Insufficient Liquidity"
                : minLoanInTokens > 0 && Number(loanAmount) < minLoanInTokens
                ? `Min ${minLoanInTokens.toFixed(currentAsset?.decimals === 6 ? 2 : 4)} ${currentAsset?.symbol ?? ""}`
                : <>Request Loan <ArrowRight className="w-4 h-4" /></>
              }
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              {collateralToken
                ? "Collateralized request — LTV-adjusted score threshold applied."
                : "Uncollateralized request — full pool min score applies."}
            </p>
          </div>
        </TabsContent>

        {/* ── My Loans ── */}
        <TabsContent value="loans" className="mt-6 space-y-4">
          {loans.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center text-muted-foreground">
              No loans yet. Request a loan from the Borrow tab.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Pending", count: pendingLoans.length, color: "text-muted-foreground" },
                  { label: "Active",  count: activeLoans.length,  color: "text-primary" },
                  { label: "With Collateral", count: loans.filter((l) => l.collateralPosted).length, color: "text-warning" },
                  { label: "Defaulted", count: loans.filter((l) => l.status === 3).length, color: "text-destructive" },
                ].map((s) => (
                  <div key={s.label} className="glass rounded-xl p-3 text-center">
                    <div className={cn("text-xl font-bold font-heading", s.color)}>{s.count}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                {loans.map((loan) => {
                  const remaining = loan.totalOwed - loan.repaidAmount;
                  const progressPct = loan.totalOwed > 0n
                    ? Number((loan.repaidAmount * 100n) / loan.totalOwed) : 0;

                  return (
                    <motion.div key={loan.id} layout
                      className={cn("glass rounded-xl p-5 border",
                        loan.status === 1 && "border-primary/20",
                        loan.status === 2 && "border-success/20",
                        loan.isOverdue && "border-destructive/30")}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">Loan #{loan.id}</span>
                            <StatusBadge status={loan.status} label={loan.statusLabel} />
                            {loan.isOverdue && (
                              <span className="text-xs text-destructive font-bold flex items-center gap-1">
                                <Clock className="w-3 h-3" /> OVERDUE
                              </span>
                            )}
                            {loan.collateralPosted && (
                              <span className="text-xs text-warning flex items-center gap-1">
                                <Shield className="w-3 h-3" /> Collateralized
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-muted-foreground space-y-0.5">
                            <div>Principal: <span className="text-foreground">{ethers.formatUnits(loan.principal, poolState.assets.find(a=>a.address===loan.token)?.decimals ?? 18)} {loan.tokenSymbol}</span></div>
                            <div>Total owed: <span className="text-foreground">{ethers.formatUnits(loan.totalOwed, poolState.assets.find(a=>a.address===loan.token)?.decimals ?? 18)} {loan.tokenSymbol}</span></div>
                            <div>Repaid: <span className={loan.repaidAmount > 0n ? "text-success" : "text-foreground"}>{ethers.formatUnits(loan.repaidAmount, poolState.assets.find(a=>a.address===loan.token)?.decimals ?? 18)} {loan.tokenSymbol}</span></div>
                            {loan.status === 1 && remaining > 0n && (
                              <div>Remaining: <span className="text-warning">{ethers.formatUnits(remaining, poolState.assets.find(a=>a.address===loan.token)?.decimals ?? 18)} {loan.tokenSymbol}</span></div>
                            )}
                            {loan.collateralPosted && loan.collateralToken !== ethers.ZeroAddress && (
                              <div>Collateral: <span className="text-foreground">{ethers.formatUnits(loan.collateralAmount, poolState.assets.find(a=>a.address===loan.collateralToken)?.decimals ?? 18)} {poolState.assets.find(a=>a.address===loan.collateralToken)?.symbol ?? loan.collateralToken.slice(0,6)}…</span></div>
                            )}
                          </div>

                          {loan.dueDate > 0n && loan.status !== 2 && (
                            <div className="text-xs text-muted-foreground">
                              Due: {new Date(Number(loan.dueDate) * 1000).toLocaleDateString()}
                            </div>
                          )}

                          {loan.status === 1 && (
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Repayment progress</span><span>{progressPct}%</span>
                              </div>
                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full transition-all duration-500"
                                  style={{ width: `${progressPct}%` }} />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-2 shrink-0">
                          {loan.status === 0 && (
                            <Button size="sm" variant="outline" className="text-xs"
                              onClick={() => resolveLoanApproval(loan.id)} disabled={loading}>
                              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Resolve"}
                            </Button>
                          )}

                          {loan.status === 1 && (
                            repayId === loan.id ? (
                              <div className="flex gap-1">
                                <Input type="number" className="w-24 h-8 text-xs"
                                  value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)}
                                  placeholder="Amount" />
                                <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground"
                                  onClick={() => handleRepay(loan)} disabled={loading}>
                                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "✓"}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8 text-xs"
                                  onClick={() => { setRepayId(null); setRepayAmount(""); }}>✕</Button>
                              </div>
                            ) : (
                              <Button size="sm" className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                                onClick={() => {
                                  setRepayId(loan.id);
                                  const dec = poolState.assets.find(a=>a.address===loan.token)?.decimals ?? 18;
                                  setRepayAmount(ethers.formatUnits(remaining, dec));
                                }}>
                                Repay
                              </Button>
                            )
                          )}

                          {loan.status === 1 && loan.collateralPosted && (
                            <Button size="sm" variant="outline" className="text-xs text-destructive"
                              onClick={() => markDefaulted(loan.id)} disabled={loading}>
                              Mark Defaulted
                            </Button>
                          )}

                          {loan.status === 2 && (
                            <div className="text-xs text-success flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Repaid
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
