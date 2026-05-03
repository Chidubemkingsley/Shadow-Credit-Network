import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useWallet } from "@/lib/wallet";
import { useReputation, REPUTATION_FACTORS } from "@/hooks/useReputation";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Info, ArrowRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Reputation() {
  const { isConnected, address } = useWallet();
  const {
    repProfile, loading, error, txHash, hasRegistry,
    isFHENetwork,
    loadReputation, register, requestDecryption, applyDecay,
    canApplyDecay, daysUntilDecay, clearError,
  } = useReputation();

  const [lastAction, setLastAction] = useState<"register" | "decrypt" | "decay" | null>(null);

  useEffect(() => {
    if (isConnected && address) loadReputation();
  }, [isConnected, address, loadReputation]);

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass rounded-2xl p-12 text-center space-y-4">
          <div className="text-4xl">⭐</div>
          <h2 className="text-2xl font-bold font-heading">Connect Your Wallet</h2>
          <p className="text-muted-foreground">Connect to Base Sepolia to view your reputation profile.</p>
        </div>
      </div>
    );
  }

  // No registry configured
  if (!hasRegistry) {
    return (
      <div className="max-w-3xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold font-heading">Reputation</h1>
          <p className="text-muted-foreground mt-1">FHE-encrypted composite reputation scoring</p>
        </div>
        <div className="glass rounded-2xl p-8 border border-warning/30 flex items-start gap-4">
          <Info className="w-5 h-5 text-warning mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-warning mb-1">ReputationRegistry not configured</div>
            <p className="text-sm text-muted-foreground">
              Set <code className="bg-muted px-1 rounded text-xs">VITE_REPUTATION_REGISTRY_ADDRESS</code> in{" "}
              <code className="bg-muted px-1 rounded text-xs">frontend/.env.local</code>.
              <br />
              Deployed address: <code className="bg-muted px-1 rounded text-xs">0xeecAb683D93a483669D797E4B7a06e8c286A25dC</code>
            </p>
          </div>
        </div>
        <FactorWeights />
      </div>
    );
  }

  const scorePercent = repProfile.compositeScore !== null
    ? (repProfile.compositeScore / 10000) * 100
    : 0;

  const handleRegister = async () => {
    setLastAction("register");
    await register();
  };

  const handleDecrypt = async () => {
    setLastAction("decrypt");
    await requestDecryption();
  };

  const handleDecay = async () => {
    setLastAction("decay");
    await applyDecay();
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-heading">Reputation</h1>
          <p className="text-muted-foreground mt-1">FHE-encrypted composite reputation scoring</p>
        </div>
        <Button variant="ghost" size="sm" onClick={loadReputation} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Error */}
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
            {lastAction === "register" && "Registered successfully! "}
            {lastAction === "decrypt" && "Decryption requested — poll in a few blocks. "}
            {lastAction === "decay" && "Decay applied successfully! "}
            <a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" className="underline font-mono text-primary">
              {txHash.slice(0, 20)}…
            </a>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top 2-col grid */}
      <div className="grid md:grid-cols-2 gap-6">

        {/* ── Status card ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 space-y-4">
          <h3 className="font-heading font-semibold">Status</h3>

          {!repProfile.isRegistered ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Register to start tracking your on-chain reputation. Your score starts at 50% (neutral) and updates automatically as you use the protocol.
              </p>
              <Button
                onClick={handleRegister}
                disabled={loading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              >
                {loading && lastAction === "register"
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirming…</>
                  : <>Register <ArrowRight className="w-4 h-4" /></>
                }
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-success font-semibold text-sm">
                <CheckCircle2 className="w-4 h-4" /> Registered
              </div>

              {/* Real data from chain */}
              <div className="space-y-2">
                {[
                  {
                    label: "Registered",
                    value: repProfile.registeredAt
                      ? new Date(repProfile.registeredAt * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
                      : "—",
                  },
                  {
                    label: "Last Activity",
                    value: repProfile.lastActivityAt
                      ? new Date(repProfile.lastActivityAt * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
                      : "—",
                  },
                  {
                    label: "Active Attestations",
                    value: `${repProfile.activeAttestations} / ${repProfile.minAttestations} required`,
                  },
                  {
                    label: "Decay Interval",
                    value: `${Math.round(repProfile.decayInterval / 86400)} days`,
                  },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium">{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Activity note */}
              <div className="glass rounded-lg p-3 border border-primary/10 text-xs text-muted-foreground">
                <span className="text-primary font-semibold">Auto-updates:</span> Your reputation updates automatically when you compute a credit score, repay a loan, or repay a delegation bond.
              </div>
            </div>
          )}
        </motion.div>

        {/* ── Composite score card ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-2xl p-6 space-y-4">
          <h3 className="font-heading font-semibold">Composite Score</h3>

          {repProfile.compositeScore !== null ? (
            <div className="text-center space-y-3">
              {/* Score ring */}
              <div className="relative w-28 h-28 mx-auto">
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
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold font-heading text-primary">{scorePercent.toFixed(1)}%</span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {repProfile.compositeScore} / 10000 basis points
              </div>
              <div className="text-xs text-success flex items-center justify-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Decrypted
              </div>
            </div>
          ) : repProfile.isRegistered ? (
            <div className="space-y-3 text-center">
              {/* Encrypted ring */}
              <div className="relative w-28 h-28 mx-auto">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r="42" fill="none"
                    stroke="hsl(var(--primary) / 0.35)" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 42 * 0.12} ${2 * Math.PI * 42 * 0.88}`}
                    className="transition-all duration-1000"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl">🔐</span>
                </div>
              </div>

              {isFHENetwork ? (
                /* CoFHE network — decryption is possible */
                <>
                  <p className="text-sm text-muted-foreground">
                    Score is FHE-encrypted on-chain. Request decryption to view it.
                  </p>
                  <Button
                    onClick={handleDecrypt}
                    disabled={loading}
                    variant="outline"
                    className="w-full gap-2"
                  >
                    {loading && lastAction === "decrypt"
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Requesting…</>
                      : <>Request FHE Decryption <ArrowRight className="w-4 h-4" /></>
                    }
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Async — poll again after a few blocks.
                  </p>
                </>
              ) : (
                /* Base Sepolia — FHE.decrypt() not available */
                <>
                  <div className="text-xs font-semibold text-primary">Score Computed ✓</div>
                  <p className="text-sm text-muted-foreground">
                    Reputation score is stored as an FHE ciphertext on-chain.
                  </p>
                  <div className="glass rounded-lg p-3 border border-warning/20 text-xs text-left space-y-1.5">
                    <div className="font-semibold text-warning flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3" /> Base Sepolia limitation
                    </div>
                    <p className="text-muted-foreground">
                      <code className="bg-muted px-1 rounded">FHE.decrypt()</code> requires the CoFHE task manager,
                      which is only deployed on <strong className="text-foreground">Fhenix Helium</strong> or <strong className="text-foreground">localcofhe</strong>.
                      Your score is valid for all protocol operations — it just can't be revealed as a plaintext number on this network.
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Register first to view your score.</p>
          )}
        </motion.div>
      </div>

      {/* ── Reputation Factors ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass rounded-2xl p-6">
        <h3 className="font-heading font-semibold mb-2">Reputation Factors</h3>
        <p className="text-xs text-muted-foreground mb-6">
          Six weighted factors compose your score. All values are FHE-encrypted — the composite is computed on-chain without revealing individual factors.
          DefaultHistory is inverted: fewer defaults = higher contribution.
        </p>
        <div className="space-y-4">
          {REPUTATION_FACTORS.map((f, i) => (
            <div key={f.name} className="flex items-center gap-4">
              <div className="w-52 shrink-0">
                <div className="text-sm text-muted-foreground">{f.name}</div>
                <div className="text-xs text-muted-foreground/60">
                  {f.index === 5 ? "Inverted — lower defaults = better" : `Weight: ${f.weight}%`}
                </div>
              </div>
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${f.weight * 3.3}%` }}
                  transition={{ delay: 0.3 + i * 0.08, duration: 0.8 }}
                  className={cn(
                    "h-full rounded-full",
                    f.index === 5
                      ? "bg-gradient-to-r from-destructive/60 to-destructive/40"
                      : "bg-gradient-to-r from-primary to-accent"
                  )}
                />
              </div>
              <span className="text-sm font-bold w-10 text-right">{f.weight}%</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── Decay section ── */}
      {repProfile.isRegistered && (
        <div className="glass rounded-2xl p-6 flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 font-heading font-semibold">
              <Clock className="w-4 h-4 text-primary" />
              Reputation Decay
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {canApplyDecay()
                ? "Decay is ready — 90+ days of inactivity detected. Apply to update your score."
                : `Next decay available in ${daysUntilDecay()} days (90-day interval).`}
            </p>
            {repProfile.lastActivityAt > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Last activity: {new Date(repProfile.lastActivityAt * 1000).toLocaleDateString()}
              </p>
            )}
          </div>
          <Button
            variant={canApplyDecay() ? "default" : "outline"}
            size="sm"
            onClick={handleDecay}
            disabled={loading || !canApplyDecay()}
            className={canApplyDecay() ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}
          >
            {loading && lastAction === "decay"
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : canApplyDecay()
              ? "Apply Decay"
              : `${daysUntilDecay()}d remaining`
            }
          </Button>
        </div>
      )}
    </div>
  );
}

function FactorWeights() {
  return (
    <div className="glass rounded-2xl p-6">
      <h3 className="font-heading font-semibold mb-6">Reputation Factor Weights</h3>
      <div className="space-y-4">
        {REPUTATION_FACTORS.map((f, i) => (
          <div key={f.name} className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground w-52 shrink-0">{f.name}</span>
            <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${f.weight * 3.3}%` }}
                transition={{ delay: 0.2 + i * 0.08, duration: 0.7 }}
                className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
              />
            </div>
            <span className="text-sm font-semibold w-10 text-right">{f.weight}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
