import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/lib/wallet";
import { useCreditEngine } from "@/hooks/useCreditEngine";
import { useNavigate } from "react-router-dom";
import {
  Clock, History, Zap, AlertTriangle, CheckCircle2,
  Loader2, Plug, Shield, ArrowRight, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const navigate = useNavigate();
  const { isConnected, address, connect, isConnecting, isWrongNetwork, switchNetwork } = useWallet();
  const {
    profile, loading, error, txHash,
    loadProfile, register, computeScore, requestDecryption, computeBorrowingPower,
    clearError, isV3,
  } = useCreditEngine();

  // Track which action just completed for success messaging
  const [lastAction, setLastAction] = useState<"register" | "compute" | "decrypt" | null>(null);

  useEffect(() => {
    if (isConnected && address) loadProfile();
  }, [isConnected, address, loadProfile]);

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-3xl p-12 text-center space-y-6 max-w-md w-full"
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold font-heading mb-2">Shadow Credit Network</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Connect your wallet to Base Sepolia to access your on-chain credit profile,
              borrow from risk-tiered pools, and build encrypted reputation.
            </p>
          </div>
          {isWrongNetwork ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-sm text-warning">
                <AlertTriangle className="w-4 h-4" /> Wrong network detected
              </div>
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2" onClick={switchNetwork}>
                Switch to Base Sepolia
              </Button>
            </div>
          ) : (
            <Button
              size="lg"
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2 py-6 text-base font-heading font-semibold"
              onClick={connect}
              disabled={isConnecting}
            >
              <Plug className="w-5 h-5" />
              {isConnecting ? "Connecting…" : "Connect Wallet"}
            </Button>
          )}
          <div className="grid grid-cols-3 gap-3 pt-2">
            {[
              { label: "Credit Score", value: "300–850" },
              { label: "Risk Pools", value: "3 tiers" },
              { label: "Encryption", value: "FHE" },
            ].map((s) => (
              <div key={s.label} className="bg-muted/50 rounded-xl p-3">
                <div className="text-sm font-bold font-heading text-primary">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  const scorePercent = profile.score ? ((profile.score - 300) / (850 - 300)) * 100 : 0;

  const handleRegister = async () => {
    setLastAction("register");
    await register();
  };

  const handleComputeScore = async () => {
    setLastAction("compute");
    await computeScore();
  };

  const handleDecrypt = async () => {
    setLastAction("decrypt");
    await requestDecryption();
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-heading">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Your on-chain credit overview</p>
        </div>
        <Button variant="ghost" size="sm" onClick={loadProfile} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass rounded-xl p-4 border border-destructive/30 flex items-start gap-3"
          >
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 text-sm text-destructive">{error}</div>
            <button onClick={clearError} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tx confirmed */}
      <AnimatePresence>
        {txHash && !error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass rounded-xl p-3 border border-success/30 flex items-center gap-2 text-xs text-success"
          >
            <CheckCircle2 className="w-4 h-4" />
            {lastAction === "register" && "Wallet registered successfully! "}
            {lastAction === "compute" && "Credit score computed successfully! "}
            {lastAction === "decrypt" && "Decryption requested — poll in a few blocks. "}
            <a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" className="underline font-mono text-primary">
              {txHash.slice(0, 20)}…
            </a>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main 3-col grid */}
      <div className="grid md:grid-cols-3 gap-6">

        {/* ── Registration ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 space-y-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Step 1</div>
          <div className="text-sm font-semibold">Registration</div>
          {profile.isRegistered ? (
            <div className="flex items-center gap-2 text-success text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Registered on-chain
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Register your wallet to create your credit profile.</p>
              <Button
                onClick={handleRegister}
                disabled={loading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                size="sm"
              >
                {loading && lastAction === "register"
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Confirming…</>
                  : <>Register On-Chain <ArrowRight className="w-3 h-3" /></>
                }
              </Button>
            </div>
          )}
        </motion.div>

        {/* ── Credit Score ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-2xl p-6 text-center space-y-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Step 2</div>
          <div className="text-sm font-semibold">Credit Score</div>

          {profile.score !== null ? (
            <>
              <div className="relative w-24 h-24 mx-auto">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r="42" fill="none"
                    stroke="hsl(var(--primary))" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 42}`}
                    strokeDashoffset={`${2 * Math.PI * 42 * (1 - scorePercent / 100)}`}
                    className="transition-all duration-1000"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold font-heading text-primary">{profile.score}</span>
                </div>
              </div>
              <div className={cn("text-xs font-semibold", profile.riskColor)}>{profile.riskTier}</div>
              {isV3 ? (
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  🔐 Encrypted on-chain (FHE)
                </div>
              ) : !profile.isDecrypted ? (
                <Button variant="outline" size="sm" className="text-xs w-full" onClick={handleDecrypt} disabled={loading}>
                  {loading && lastAction === "decrypt"
                    ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Requesting…</>
                    : "Request Decryption"
                  }
                </Button>
              ) : (
                <div className="text-xs text-success flex items-center justify-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Decrypted
                </div>
              )}
            </>
          ) : profile.isRegistered && profile.hasCreditScore ? (
            /* Score computed on V3 but not decryptable on Base Sepolia — show encrypted state */
            <div className="space-y-3">
              {/* Encrypted score ring — shows as locked */}
              <div className="relative w-24 h-24 mx-auto">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r="42" fill="none"
                    stroke="hsl(var(--primary) / 0.4)" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 42 * 0.15} ${2 * Math.PI * 42 * 0.85}`}
                    className="transition-all duration-1000"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                  <span className="text-2xl">🔐</span>
                </div>
              </div>

              <div className="text-xs font-semibold text-primary">Score Computed ✓</div>

              {isV3 && profile.scoreCtHash ? (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Ciphertext handle:</div>
                  <div className="text-xs font-mono text-primary/70 bg-muted rounded px-2 py-1 break-all">
                    {profile.scoreCtHash.slice(0, 18)}…{profile.scoreCtHash.slice(-8)}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Stored as FHE ciphertext on-chain.
                </p>
              )}

              <div className="text-xs text-muted-foreground">
                Decryption requires Fhenix Helium network.
                Score is valid for loan approval via ebool comparison.
              </div>

              {!isV3 && (
                <Button variant="outline" size="sm" className="text-xs w-full" onClick={handleDecrypt} disabled={loading}>
                  {loading && lastAction === "decrypt"
                    ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Requesting…</>
                    : "Request Decryption"
                  }
                </Button>
              )}
            </div>
          ) : profile.isRegistered ? (
            <div className="space-y-2">
              <div className="text-2xl text-muted-foreground/50 font-heading">---</div>
              <p className="text-xs text-muted-foreground">Submit data first, then compute your score.</p>
              <Button
                size="sm"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-1 text-xs"
                onClick={() => navigate("/app/submit")}
              >
                Go to Submit Data <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Register first</div>
          )}
        </motion.div>

        {/* ── Risk Tier ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass rounded-2xl p-6 space-y-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Step 3</div>
          <div className="text-sm font-semibold">Risk Tier & Borrowing</div>
          {profile.riskTier !== "Unknown" ? (
            <>
              <div className={cn("text-2xl font-bold font-heading", profile.riskColor)}>{profile.riskTier}</div>
              <div className="text-xs text-muted-foreground">Borrowing factor: {profile.riskFactor}% of income</div>
              <Button
                size="sm"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-1 text-xs"
                onClick={() => navigate("/app/borrow")}
              >
                Go to Borrow <ArrowRight className="w-3 h-3" />
              </Button>
            </>
          ) : isV3 && profile.hasCreditScore ? (
            /* V3: score computed but encrypted — still eligible for Aggressive pool (score ≥ 300) */
            <div className="space-y-2">
              <div className="text-xl font-bold font-heading text-warning">Encrypted</div>
              <div className="text-xs text-muted-foreground">
                Score is FHE-encrypted. Eligible for <span className="text-warning font-semibold">Aggressive pool</span> (min score 580 checked via ebool).
              </div>
              <Button
                size="sm"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-1 text-xs"
                onClick={() => navigate("/app/borrow")}
              >
                Go to Borrow <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Compute your score to see your risk tier</div>
          )}
        </motion.div>
      </div>

      {/* ── Compute Score CTA (shown when registered + data submitted but no score yet) ── */}
      {profile.isRegistered && profile.hasCreditScore === false && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-6 flex items-center justify-between gap-4"
        >
          <div>
            <div className="font-semibold text-sm">Ready to compute your score</div>
            <div className="text-xs text-muted-foreground mt-1">
              Data submitted. Click to run the credit score formula on-chain.
            </div>
          </div>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 shrink-0"
            onClick={handleComputeScore}
            disabled={loading}
          >
            {loading && lastAction === "compute"
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Computing…</>
              : <>Compute Score <ArrowRight className="w-4 h-4" /></>
            }
          </Button>
        </motion.div>
      )}

      {/* ── Wave 3 features (V3 engine only) ── */}
      {isV3 && profile.isRegistered && (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="glass rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="w-4 h-4 text-primary" /> Score Freshness
            </div>
            {profile.scoreComputedAt ? (
              <>
                <div className="text-xs text-muted-foreground">
                  Computed: {new Date(profile.scoreComputedAt * 1000).toLocaleDateString()}
                </div>
                <div className={cn("text-xs font-semibold", profile.isScoreStale ? "text-destructive" : "text-success")}>
                  {profile.isScoreStale ? "⚠ Stale — recompute required" : "✓ Fresh (valid 180 days)"}
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">No score computed yet</div>
            )}
          </div>

          <div className="glass rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <History className="w-4 h-4 text-primary" /> Score History
            </div>
            <div className="text-2xl font-bold font-heading text-primary">{profile.scoreHistoryLength}</div>
            <div className="text-xs text-muted-foreground">Encrypted snapshots on-chain</div>
          </div>

          <div className="glass rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="w-4 h-4 text-primary" /> Borrowing Power
            </div>
            {profile.hasBorrowingPower ? (
              <div className="text-xs text-success">✓ Computed (FHE-encrypted)</div>
            ) : (
              <Button
                size="sm" variant="outline" className="text-xs w-full"
                onClick={computeBorrowingPower}
                disabled={loading || !profile.hasCreditScore}
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Compute"}
              </Button>
            )}
            <div className="text-xs text-muted-foreground">income × risk factor − debt</div>
          </div>
        </div>
      )}

      {/* ── Quick actions ── */}
      {profile.isRegistered && (
        <div className="grid md:grid-cols-3 gap-3">
          {[
            { label: "Submit Credit Data", desc: "Update your financial profile", path: "/app/submit", color: "border-primary/20" },
            { label: "Borrow ETH", desc: "Request from risk-tiered pools", path: "/app/borrow", color: "border-success/20" },
            { label: "Delegation Market", desc: "Create or accept credit bonds", path: "/app/delegation", color: "border-warning/20" },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn("glass rounded-xl p-4 text-left border hover:bg-muted/30 transition-colors", item.color)}
            >
              <div className="text-sm font-semibold">{item.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{item.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
