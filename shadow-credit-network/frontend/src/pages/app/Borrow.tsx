import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet";
import { useLoanPool } from "@/hooks/useLoanPool";
import { useCreditEngine } from "@/hooks/useCreditEngine";
import { ADDRESSES, getLoanPoolContract, parseContractError, getLoanStatusLabel } from "@/lib/contracts";
import {
  AlertTriangle, CheckCircle2, Loader2, RefreshCw,
  TrendingUp, ArrowRight, Clock, FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Wave 1 demo pool (Base Sepolia, plaintext approval, no FHE) ───────────────
const W1_POOL_ADDRESS = import.meta.env.VITE_LOAN_POOL_ADDRESS ?? "0x0A2AB73CB8311aFD261Ab92137ff70E9Ca268d69";

function useDemoPool() {
  const { signer, provider, address } = useWallet();
  const [demoLoans, setDemoLoans] = useState<any[]>([]);
  const [demoPool, setDemoPool] = useState({ total: 0n, available: 0n, deposit: 0n });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Use Wave 1 ABI directly — same requestLoan signature, different getLoan return
  const W1_ABI = [
    "function fundPool() external payable",
    "function withdrawFunds(uint256 amount) external",
    "function requestLoan(uint256 principal, uint256 duration, uint8 riskPool) external",
    "function repayLoan(uint256 loanId) external payable",
    "function getLoan(uint256) external view returns (address borrower, uint256 principal, uint256 interestRate, uint256 repaidAmount, uint256 totalOwed, uint256 status, uint256 dueDate, bool creditVerified, bool creditPassed)",
    "function getBorrowerLoans(address) external view returns (uint256[])",
    "function getLenderDeposit(address) external view returns (uint256 amount, uint256 depositedAt)",
    "function totalPoolLiquidity() external view returns (uint256)",
    "function getAvailableLiquidity() external view returns (uint256)",
    "function loanCount() external view returns (uint256)",
  ];

  const getRC = useCallback(() => provider ? new ethers.Contract(W1_POOL_ADDRESS, W1_ABI, provider) : null, [provider]);
  const getSC = useCallback(() => signer  ? new ethers.Contract(W1_POOL_ADDRESS, W1_ABI, signer)   : null, [signer]);

  const load = useCallback(async () => {
    const rc = getRC(); if (!rc) return;
    try {
      const [total, available] = await Promise.all([rc.totalPoolLiquidity(), rc.getAvailableLiquidity()]);
      let deposit = 0n;
      if (address) { try { const [d] = await rc.getLenderDeposit(address); deposit = d; } catch {} }
      setDemoPool({ total, available, deposit });

      if (address) {
        const ids: bigint[] = await rc.getBorrowerLoans(address);
        const now = Math.floor(Date.now() / 1000);
        const loaded = await Promise.all(ids.map(async (id) => {
          const l = await rc.getLoan(id);
          const status = Number(l[5]);
          const dueDate = BigInt(l[6] ?? 0);
          return {
            id: Number(id), principal: BigInt(l[1]), totalOwed: BigInt(l[4]),
            repaidAmount: BigInt(l[3]), dueDate, status,
            statusLabel: getLoanStatusLabel(status),
            isOverdue: status === 1 && Number(dueDate) > 0 && Number(dueDate) < now,
          };
        }));
        setDemoLoans(loaded);
      }
    } catch (e) { console.error("demo load", e); }
  }, [address, getRC]);

  const fund = useCallback(async (eth: string) => {
    const sc = getSC(); if (!sc) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await sc.fundPool({ value: ethers.parseEther(eth) });
      setTxHash(tx.hash); await tx.wait(); await load();
    } catch (e: any) { setError(parseContractError(e)); } finally { setLoading(false); }
  }, [getSC, load]);

  const borrow = useCallback(async (eth: string, days: number, pool: number) => {
    const sc = getSC(); if (!sc) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await sc.requestLoan(ethers.parseEther(eth), days * 86400, pool);
      setTxHash(tx.hash); await tx.wait(); await load();
    } catch (e: any) { setError(parseContractError(e)); } finally { setLoading(false); }
  }, [getSC, load]);

  const repay = useCallback(async (loanId: number, eth: string) => {
    const sc = getSC(); if (!sc) return;
    setLoading(true); setError(null); setTxHash(null);
    try {
      const tx = await sc.repayLoan(loanId, { value: ethers.parseEther(eth) });
      setTxHash(tx.hash); await tx.wait(); await load();
    } catch (e: any) { setError(parseContractError(e)); } finally { setLoading(false); }
  }, [getSC, load]);

  return { demoLoans, demoPool, loading, error, txHash, load, fund, borrow, repay, clearError: () => setError(null) };
}

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

export default function Borrow() {
  const { isConnected, address } = useWallet();
  const {
    poolState, loans, loading, error, txHash,
    loadPoolState, loadLoans, fundPool, withdrawFunds, claimYield,
    requestLoan, resolveLoanApproval, repayLoan, refinanceLoan,
    clearError, isV3, isFHENetwork,
  } = useLoanPool();
  const { profile, loadProfile } = useCreditEngine();
  const demo = useDemoPool();

  // Demo mode: use Wave 1 pool on Base Sepolia when V3 FHE isn't available
  const canUseDemoMode = isV3 && !isFHENetwork;
  const [demoMode, setDemoMode] = useState(false);
  // Auto-enable demo mode when on Base Sepolia + V3
  useEffect(() => { if (canUseDemoMode) setDemoMode(true); }, [canUseDemoMode]);

  const [fundAmount, setFundAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [loanAmount, setLoanAmount] = useState("0.01");
  const [loanDays, setLoanDays] = useState("30");
  const [selectedPool, setSelectedPool] = useState(0);
  const [repayId, setRepayId] = useState<number | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [refinanceId, setRefinanceId] = useState<number | null>(null);
  const [refinancePool, setRefinancePool] = useState(0);
  const [activeTab, setActiveTab] = useState("lend");

  useEffect(() => {
    if (isConnected && address) {
      loadPoolState(); loadLoans(); loadProfile();
      if (canUseDemoMode) demo.load();
    }
  }, [isConnected, address]);

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass rounded-2xl p-12 text-center space-y-4">
          <div className="text-4xl">💰</div>
          <h2 className="text-2xl font-bold font-heading">Connect Your Wallet</h2>
          <p className="text-muted-foreground">Connect to Base Sepolia to access lending and borrowing.</p>
        </div>
      </div>
    );
  }

  // Active data source — demo mode uses Wave 1 pool, normal uses V3
  const activeLoading = demoMode ? demo.loading : loading;
  const activeError   = demoMode ? demo.error   : error;
  const activeTxHash  = demoMode ? demo.txHash  : txHash;
  const activeClear   = demoMode ? demo.clearError : clearError;

  const availableEth = demoMode
    ? Number(ethers.formatEther(demo.demoPool.available))
    : Number(ethers.formatEther(poolState.availableLiquidity));
  const totalEth = demoMode
    ? Number(ethers.formatEther(demo.demoPool.total))
    : Number(ethers.formatEther(poolState.totalLiquidity));
  const depositEth = demoMode
    ? Number(ethers.formatEther(demo.demoPool.deposit))
    : Number(ethers.formatEther(poolState.lenderDeposit));
  const yieldEth = Number(ethers.formatEther(poolState.lenderYieldEarned));

  const activeLoans  = (demoMode ? demo.demoLoans : loans).filter((l) => l.status === 1);
  const pendingLoans = (demoMode ? demo.demoLoans : loans).filter((l) => l.status === 0);
  const repaidLoans  = (demoMode ? demo.demoLoans : loans).filter((l) => l.status === 2);
  const allLoans     = demoMode ? demo.demoLoans : loans;

  const handleFund    = (eth: string) => demoMode ? demo.fund(eth)   : fundPool(eth);
  const handleWithdraw = (eth: string) => demoMode ? Promise.resolve() : withdrawFunds(eth);
  const handleRequestLoan = async () => {
    if (demoMode) { await demo.borrow(loanAmount, Number(loanDays), selectedPool); }
    else          { await requestLoan(loanAmount, Number(loanDays), selectedPool); }
    setActiveTab("loans");
  };
  const handleRepay = (id: number, eth: string) =>
    demoMode ? demo.repay(id, eth) : repayLoan(id, eth);
  const handleRefresh = () => {
    if (demoMode) { demo.load(); loadProfile(); }
    else          { loadPoolState(); loadLoans(); }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-heading">Lending & Borrowing</h1>
          <p className="text-muted-foreground mt-1">
            {demoMode
              ? "Demo Mode — Wave 1 pool · plaintext approval · instant disburse"
              : isV3 ? "V3 Pool — ebool-gated approval · lender yield · refinancing"
              : "Fund pools or borrow from risk-tiered liquidity"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canUseDemoMode && (
            <button
              onClick={() => setDemoMode((d) => !d)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors",
                demoMode
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-muted border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <FlaskConical className="w-3 h-3" />
              {demoMode ? "Demo Mode ON" : "Demo Mode"}
            </button>
          )}
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={activeLoading}>
            <RefreshCw className={cn("w-4 h-4", activeLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Demo mode banner */}
      {demoMode && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="glass rounded-xl p-4 border border-primary/30 flex items-start gap-3">
          <FlaskConical className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 text-xs space-y-1">
            <div className="font-semibold text-primary">Demo Mode — Wave 1 Pool (Base Sepolia)</div>
            <p className="text-muted-foreground">
              Using <code className="bg-muted px-1 rounded">PrivateLoanPool</code> at{" "}
              <code className="bg-muted px-1 rounded font-mono">{W1_POOL_ADDRESS.slice(0, 10)}…</code>.
              Approval is instant and plaintext — no FHE required. Fund the pool below, then borrow.
              Toggle off to see the V3 FHE pool.
            </p>
          </div>
          <button onClick={() => setDemoMode(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
        </motion.div>
      )}

      {/* Pool stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Pool",    value: `${totalEth.toFixed(4)} ETH`,    color: "" },
          { label: "Available",     value: `${availableEth.toFixed(4)} ETH`, color: "text-primary" },
          { label: "Your Deposit",  value: `${depositEth.toFixed(4)} ETH`,  color: "" },
          { label: "Active Loans",  value: String(activeLoans.length),       color: "text-success" },
        ].map((s) => (
          <div key={s.label} className="glass rounded-xl p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className={cn("text-lg font-bold font-heading mt-0.5", s.color)}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Empty pool banner */}
      {totalEth === 0 && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="glass rounded-xl p-4 border border-warning/40 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning mt-0.5 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="font-semibold text-sm text-warning">Pool is empty — fund it before borrowing</div>
            <p className="text-xs text-muted-foreground">
              Go to the <strong>Lend</strong> tab and deposit ETH first (minimum 0.01 ETH).
            </p>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1 text-xs"
              onClick={() => setActiveTab("lend")}>
              Go to Lend tab <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        </motion.div>
      )}

      {/* Error / tx */}
      <AnimatePresence>
        {activeError && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="glass rounded-xl p-4 border border-destructive/30 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 text-sm text-destructive">{activeError}</div>
            <button onClick={activeClear} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </motion.div>
        )}
        {activeTxHash && !activeError && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="glass rounded-xl p-3 border border-success/30 flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="w-4 h-4" />
            Transaction confirmed:
            <a href={`https://sepolia.basescan.org/tx/${activeTxHash}`} target="_blank" rel="noreferrer"
              className="underline font-mono text-primary">{activeTxHash.slice(0, 20)}…</a>
          </motion.div>
        )}
      </AnimatePresence>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted">
          <TabsTrigger value="borrow">Borrow</TabsTrigger>
          <TabsTrigger value="lend">Lend</TabsTrigger>
          <TabsTrigger value="loans">
            My Loans
            {allLoans.length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                {allLoans.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Borrow ── */}
        <TabsContent value="borrow" className="space-y-4 mt-6">
          {profile.isScoreStale && isV3 && !demoMode && (
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
                    <span>{pool.minScore}</span>
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
              {demoMode && <span className="ml-2 text-xs text-primary font-normal">(Demo · Wave 1)</span>}
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Amount (ETH)</label>
                <Input type="number" placeholder={`Max: ${availableEth.toFixed(4)} ETH`}
                  value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)}
                  className="bg-muted" min="0.01" step="0.01" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">
                  Duration (days, max {POOLS[selectedPool].maxDays})
                </label>
                <Input type="number" value={loanDays} onChange={(e) => setLoanDays(e.target.value)}
                  className="bg-muted" min="1" max={POOLS[selectedPool].maxDays} />
              </div>
            </div>

            {!profile.hasCreditScore && !demoMode && (
              <div className="text-xs text-warning flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                You need a computed credit score to request a loan.
              </div>
            )}

            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              disabled={activeLoading || !loanAmount || availableEth === 0 || (!demoMode && !profile.hasCreditScore)}
              onClick={handleRequestLoan}
            >
              {activeLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirming in wallet…</>
                : !profile.hasCreditScore && !demoMode
                ? "Compute Credit Score First"
                : availableEth === 0
                ? "Pool Empty — Fund it in the Lend tab first"
                : demoMode
                ? <><FlaskConical className="w-4 h-4" /> Request Loan (Demo)</>
                : <>Request Loan <ArrowRight className="w-4 h-4" /></>
              }
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              {demoMode
                ? "Wave 1 pool — plaintext approval, instant disburse. No FHE required."
                : isV3 && isFHENetwork
                ? "FHE approval: score compared via ebool — ETH disbursed only when approved."
                : "Switch to Demo Mode or Fhenix Helium for full borrow flow."}
            </p>
          </div>
        </TabsContent>

        {/* ── Lend ── */}
        <TabsContent value="lend" className="space-y-6 mt-6">
          {!demoMode && isV3 && yieldEth > 0 && (
            <div className="glass rounded-2xl p-5 border border-success/20 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Accrued Yield</div>
                <div className="text-2xl font-bold font-heading text-success mt-0.5">{yieldEth.toFixed(6)} ETH</div>
                <div className="text-xs text-muted-foreground mt-1">From proportional interest distribution</div>
              </div>
              <Button className="bg-success/10 text-success hover:bg-success/20 border border-success/30 gap-2"
                onClick={claimYield} disabled={loading}>
                <TrendingUp className="w-4 h-4" />
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Claim Yield"}
              </Button>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="glass rounded-2xl p-6 space-y-3">
              <h3 className="font-heading font-semibold">Fund Pool</h3>
              <p className="text-xs text-muted-foreground">
                {demoMode ? "Fund the Wave 1 demo pool to enable borrowing."
                  : isV3 ? "Earn proportional yield when borrowers repay interest."
                  : "Provide liquidity for borrowers."}
              </p>
              <Input type="number" placeholder="Amount in ETH (min 0.01)"
                value={fundAmount} onChange={(e) => setFundAmount(e.target.value)}
                className="bg-muted" min="0.01" step="0.01" />
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={activeLoading || !fundAmount} onClick={() => handleFund(fundAmount)}>
                {activeLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Fund Pool {demoMode && "(Demo)"}
              </Button>
            </div>

            <div className="glass rounded-2xl p-6 space-y-3">
              <h3 className="font-heading font-semibold">Withdraw</h3>
              <p className="text-xs text-muted-foreground">
                Your deposit: <span className="text-foreground font-semibold">{depositEth.toFixed(4)} ETH</span>
              </p>
              <Input type="number" placeholder={`Max: ${depositEth.toFixed(4)} ETH`}
                value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
                className="bg-muted" min="0.01" step="0.01" />
              <Button variant="outline" className="w-full"
                disabled={activeLoading || !withdrawAmount || depositEth === 0}
                onClick={() => handleWithdraw(withdrawAmount)}>
                {activeLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Withdraw
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ── My Loans ── */}
        <TabsContent value="loans" className="mt-6 space-y-4">
          {allLoans.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center text-muted-foreground">
              No loans yet. Request a loan from the Borrow tab.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Pending", count: pendingLoans.length, color: "text-muted-foreground" },
                  { label: "Active",  count: activeLoans.length,  color: "text-primary" },
                  { label: "Repaid",  count: repaidLoans.length,  color: "text-success" },
                ].map((s) => (
                  <div key={s.label} className="glass rounded-xl p-3 text-center">
                    <div className={cn("text-xl font-bold font-heading", s.color)}>{s.count}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                {allLoans.map((loan) => {
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
                            {demoMode && <span className="text-xs text-primary px-1.5 py-0.5 rounded-full bg-primary/10">Demo</span>}
                            {loan.isOverdue && (
                              <span className="text-xs text-destructive font-bold flex items-center gap-1">
                                <Clock className="w-3 h-3" /> OVERDUE
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-muted-foreground space-y-0.5">
                            <div>Principal: <span className="text-foreground">{ethers.formatEther(loan.principal)} ETH</span></div>
                            <div>Total owed: <span className="text-foreground">{ethers.formatEther(loan.totalOwed)} ETH</span></div>
                            <div>Repaid: <span className={loan.repaidAmount > 0n ? "text-success" : "text-foreground"}>{ethers.formatEther(loan.repaidAmount)} ETH</span></div>
                            {loan.status === 1 && remaining > 0n && (
                              <div>Remaining: <span className="text-warning">{ethers.formatEther(remaining)} ETH</span></div>
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

                          {!demoMode && isV3 && loan.status === 0 && (
                            <div className="text-xs">
                              {loan.approvalResolved
                                ? loan.approvalPassed
                                  ? <span className="text-success">✓ FHE approved — awaiting disburse</span>
                                  : <span className="text-destructive">✗ FHE rejected — score below threshold</span>
                                : <span className="text-muted-foreground">⏳ Awaiting FHE decryption (poll below)</span>
                              }
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-2 shrink-0">
                          {!demoMode && loan.status === 0 && isV3 && !loan.approvalResolved && (
                            <Button size="sm" variant="outline" className="text-xs"
                              onClick={() => resolveLoanApproval(loan.id)} disabled={loading}>
                              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Poll Approval"}
                            </Button>
                          )}

                          {loan.status === 1 && (
                            repayId === loan.id ? (
                              <div className="flex gap-1">
                                <Input type="number" className="w-24 h-8 text-xs"
                                  value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)}
                                  placeholder="ETH" />
                                <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground"
                                  onClick={() => handleRepay(loan.id, repayAmount)} disabled={activeLoading}>
                                  {activeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "✓"}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8 text-xs"
                                  onClick={() => { setRepayId(null); setRepayAmount(""); }}>✕</Button>
                              </div>
                            ) : (
                              <Button size="sm"
                                className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                                onClick={() => { setRepayId(loan.id); setRepayAmount(ethers.formatEther(remaining)); }}>
                                Repay
                              </Button>
                            )
                          )}

                          {loan.status === 2 && (
                            <div className="text-xs text-success flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Repaid
                            </div>
                          )}

                          {!demoMode && loan.status === 1 && isV3 && (
                            refinanceId === loan.id ? (
                              <div className="flex gap-1">
                                <select className="h-8 text-xs bg-muted border border-border rounded px-1"
                                  value={refinancePool} onChange={(e) => setRefinancePool(Number(e.target.value))}>
                                  {POOLS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                                <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground"
                                  onClick={() => refinanceLoan(loan.id, refinancePool)} disabled={loading}>
                                  Refi
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8 text-xs"
                                  onClick={() => setRefinanceId(null)}>✕</Button>
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" className="text-xs"
                                onClick={() => setRefinanceId(loan.id)}>
                                Refinance
                              </Button>
                            )
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
