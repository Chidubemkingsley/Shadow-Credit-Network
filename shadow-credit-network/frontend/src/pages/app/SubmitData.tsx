import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useMemo, useEffect } from "react";
import { useWallet } from "@/lib/wallet";
import { useCreditEngine } from "@/hooks/useCreditEngine";
import { computeScorePreview, getRiskTierFromScore, ADDRESSES } from "@/lib/contracts";
import { AlertTriangle, CheckCircle2, Loader2, ArrowRight, Info, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SubmitData() {
  const { isConnected, address } = useWallet();
  const {
    profile, loading, error, txHash,
    loadProfile, register, submitCreditData, computeScore, requestDecryption,
    clearError, isV3,
  } = useCreditEngine();

  const [data, setData] = useState({
    income: "5",
    totalDebt: "1",
    paymentHistory: "9500",
    creditUtilization: "3000",
    accountAge: "365",
    numDefaults: "0",
  });

  const [completedStep, setCompletedStep] = useState<number | null>(null);

  useEffect(() => {
    if (isConnected && address) loadProfile();
  }, [isConnected, address, loadProfile]);

  // Steps are Register → Submit Data → Compute Score
  const steps = [
    { id: 0, label: "Register Wallet" },
    { id: 1, label: "Submit Data" },
    { id: 2, label: "Compute Score" }
  ];

  // Current step based on on-chain state
  // 1. If not registered: step 0
  // 2. If registered but no score computed:
  //    - If V3 and we just submitted data (completedStep 1): step 2
  //    - Otherwise: step 1 (submit data)
  // 3. If has score: step 2 (results)
  const step = useMemo(() => {
    if (!profile.isRegistered) return 0;
    if (profile.hasCreditScore) return 2;
    if (completedStep === 1) return 2;
    return 1;
  }, [profile.isRegistered, profile.hasCreditScore, completedStep]);

  const preview = useMemo(() => computeScorePreview(
    Number(data.paymentHistory) || 0,
    Number(data.creditUtilization) || 0,
    Number(data.accountAge) || 0,
    Number(data.numDefaults) || 0,
  ), [data]);

  const tierInfo = getRiskTierFromScore(preview);

  const valid =
    Number(data.paymentHistory) >= 0 && Number(data.paymentHistory) <= 10000 &&
    Number(data.creditUtilization) >= 0 && Number(data.creditUtilization) <= 10000 &&
    Number(data.income) > 0 &&
    Number(data.totalDebt) >= 0;

  const handleRegister = async () => {
    await register();
    setCompletedStep(0);
  };

  const handleSubmit = async () => {
    const income = BigInt(Math.round(Number(data.income || 0) * 1e18));
    const totalDebt = BigInt(Math.round(Number(data.totalDebt || 0) * 1e18));
    await submitCreditData(
      income, totalDebt,
      Number(data.paymentHistory),
      Number(data.creditUtilization),
      Number(data.accountAge),
      Number(data.numDefaults),
    );
    setCompletedStep(1);
  };

  const handleCompute = async () => {
    await computeScore();
    setCompletedStep(2);
  };

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass rounded-2xl p-12 text-center space-y-4">
          <div className="text-4xl">🔐</div>
          <h2 className="text-2xl font-bold font-heading">Connect Your Wallet</h2>
          <p className="text-muted-foreground">Connect to Arbitrum Sepolia to submit credit data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold font-heading">Submit Credit Data</h1>
        <p className="text-muted-foreground mt-1">
          {isV3
            ? "Wave 3 — Local local FHE encryption using @cofhe/sdk"
            : "Three on-chain transactions to compute your score"}
        </p>
      </div>

      {/* V3 info banner */}
      {isV3 && (
        <div className="glass rounded-xl p-4 border border-primary/20 space-y-3">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-2">
              <p className="text-xs font-semibold text-primary">Wave 3 — Local FHE Encryption</p>
              <p className="text-xs text-muted-foreground">
                Your data is encrypted <strong>locally</strong> in your browser using the 
                <code className="bg-muted px-1 rounded ml-1">@cofhe/sdk</code> before being sent to the blockchain.
                Only you can see your plaintext data. The network only sees encrypted handles.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step progress */}
      <div className="flex gap-2">
        {steps.map((s) => (
          <div key={s.id} className="flex-1">
            <div className={cn(
              "h-2 rounded-full mb-2 transition-all duration-500",
              s.id < step ? "bg-success" :
              s.id === step ? "bg-primary" :
              "bg-muted"
            )} />
            <div className="flex items-center gap-1">
              {s.id < step && <CheckCircle2 className="w-3 h-3 text-success" />}
              <span className={cn(
                "text-xs",
                s.id < step ? "text-success font-semibold" :
                s.id === step ? "text-primary font-semibold" :
                "text-muted-foreground"
              )}>
                {s.label}
              </span>
            </div>
          </div>
        ))}
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
            {completedStep === 0 && "Wallet registered successfully! "}
            {completedStep === 1 && (isV3 ? "Encrypted data submitted to V3 Engine! " : "Credit data submitted! ")}
            {completedStep === 2 && "Credit score computed successfully! "}
            <a href={`https://sepolia.arbiscan.io/tx/${txHash}`} target="_blank" rel="noreferrer"
              className="underline font-mono text-primary">{txHash.slice(0, 20)}…</a>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">

        {/* ── Step 0: Register ── */}
        {step === 0 && (
          <motion.div key="step0"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="glass rounded-2xl p-8 text-center space-y-4"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
              <span className="text-xl">👛</span>
            </div>
            <div>
              <h3 className="font-heading font-bold text-lg">Register Your Wallet</h3>
              <p className="text-muted-foreground text-sm mt-1">
                Creates your on-chain credit profile on {isV3 ? "EncryptedCreditEngineV3" : "SimpleCreditEngine"}.
              </p>
            </div>
            <Button onClick={handleRegister} disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 px-8">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirming in wallet…</>
                : <>Register Wallet <ArrowRight className="w-4 h-4" /></>
              }
            </Button>
          </motion.div>
        )}

        {/* ── Step 1: Submit data (V1 and V3) ── */}
        {step === 1 && (
          <motion.div key="step1"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="glass rounded-xl p-4 border border-success/20 flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="w-4 h-4" /> Wallet registered successfully
            </div>

            <div className="grid gap-4">
              {[
                { key: "income",            label: "Annual Income (ETH)",   hint: "e.g. 5.0 — converted to wei" },
                { key: "totalDebt",         label: "Total Debt (ETH)",      hint: "e.g. 1.5 — outstanding debt" },
                { key: "paymentHistory",    label: "Payment History",       hint: "0–10000 bps (10000 = 100% on-time)" },
                { key: "creditUtilization", label: "Credit Utilization",    hint: "0–10000 bps (lower is better)" },
                { key: "accountAge",        label: "Account Age (days)",    hint: "Days since account opened" },
                { key: "numDefaults",       label: "Number of Defaults",    hint: "Count of past payment failures" },
              ].map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-sm">{f.label}</Label>
                  <Input type="number" placeholder={f.hint}
                    value={data[f.key as keyof typeof data]}
                    onChange={(e) => setData((d) => ({ ...d, [f.key]: e.target.value }))}
                    className="bg-muted border-border" min="0" />
                  <p className="text-xs text-muted-foreground">{f.hint}</p>
                </div>
              ))}
            </div>

            {!valid && (
              <p className="text-destructive text-sm">Payment history and utilization must be 0–10000. Income must be &gt; 0.</p>
            )}

            <div className="glass rounded-xl p-4 flex items-center justify-between">
              <div>
                <span className="text-sm text-muted-foreground">Estimated Score: </span>
                <span className="text-2xl font-bold font-heading text-primary">{preview}</span>
              </div>
              <span className={cn("text-sm font-semibold px-3 py-1 rounded-full bg-muted", tierInfo.color)}>
                {tierInfo.tier}
              </span>
            </div>

            <Button onClick={handleSubmit} disabled={!valid || loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 w-full gap-2">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {isV3 ? "Encrypting Locally..." : "Confirming in wallet…"}</>
                : <>{isV3 ? "Encrypt & Submit Data" : "Submit Data On-Chain"} <ArrowRight className="w-4 h-4" /></>
              }
            </Button>
          </motion.div>
        )}

        {/* ── Step 2: Compute score ── */}
        {step === 2 && (
          <motion.div key="step2"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="glass rounded-xl p-4 border border-success/20 flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="w-4 h-4" /> {isV3 ? "Encrypted data submitted" : "Credit data submitted"}
            </div>

            <div className="glass rounded-2xl p-8 text-center space-y-6">
              {profile.hasCreditScore ? (
                <>
                  {profile.score !== null ? (
                    <>
                      <div className="relative w-32 h-32 mx-auto">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                          <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                          <circle cx="50" cy="50" r="42" fill="none"
                            stroke="hsl(var(--primary))" strokeWidth="8" strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 42}`}
                            strokeDashoffset={`${2 * Math.PI * 42 * (1 - ((profile.score - 300) / 550))}`}
                            className="transition-all duration-1000" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-3xl font-bold font-heading text-primary">{profile.score}</span>
                        </div>
                      </div>
                      <div className={cn("text-lg font-bold font-heading", profile.riskColor)}>{profile.riskTier}</div>
                      <div className="text-xs text-muted-foreground">
                        {isV3 ? "🔐 Public Score (FHE Decrypted)" : "Score computed successfully"}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-4">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                        <span className="text-2xl">🔐</span>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        Score is stored as FHE ciphertext on-chain.
                        Click below to reveal it publicly.
                      </p>
                      <Button onClick={requestDecryption} disabled={loading}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Request Decryption"}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-5xl font-bold font-heading text-primary">{preview}</div>
                  <p className="text-muted-foreground">Estimated score based on data. Click to compute on-chain.</p>
                  <Button onClick={handleCompute} disabled={loading}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 px-8">
                    {loading
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Computing on-chain…</>
                      : <>Compute Score On-Chain <ArrowRight className="w-4 h-4" /></>
                    }
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}

