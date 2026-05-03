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

  // V3: steps are Register → Compute Score (data submission is FHE-only)
  // V1: steps are Register → Submit Data → Compute Score
  const steps = isV3
    ? [{ id: 0, label: "Register Wallet" }, { id: 1, label: "Compute Score" }]
    : [{ id: 0, label: "Register Wallet" }, { id: 1, label: "Submit Data" }, { id: 2, label: "Compute Score" }];

  // Current step
  const step = !profile.isRegistered ? 0 : !profile.hasCreditScore ? 1 : (isV3 ? 2 : 2);

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

  // V1: submit data then compute
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

  // V3: skip data submission, compute directly
  const handleComputeV3 = async () => {
    await computeScore();
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
          <p className="text-muted-foreground">Connect to Base Sepolia to submit credit data.</p>
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
            ? "Wave 3 — FHE encrypted scoring on EncryptedCreditEngineV3"
            : "Three on-chain transactions to compute your score"}
        </p>
      </div>

      {/* V3 info banner */}
      {isV3 && (
        <div className="glass rounded-xl p-4 border border-primary/20 space-y-3">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-2">
              <p className="text-xs font-semibold text-primary">Wave 3 — EncryptedCreditEngineV3</p>
              <p className="text-xs text-muted-foreground">
                Credit scores are computed entirely in the FHE domain. Data submission requires
                real ciphertexts from the <code className="bg-muted px-1 rounded">@cofhe/sdk</code>.
                For this demo, click <strong>Compute Score</strong> directly — the engine computes
                on encrypted zero-initialized fields (score = 300, Aggressive pool eligible).
                To submit real encrypted data, use <code className="bg-muted px-1 rounded">submitCreditDataEncrypted()</code>.
              </p>
              <a
                href="https://cofhe-docs.fhenix.zone/client-sdk/guides/encrypting-inputs"
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                CoFHE SDK docs <ExternalLink className="w-3 h-3" />
              </a>
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
            {completedStep === 1 && (isV3 ? "Score computed on V3 engine! " : "Credit data submitted! ")}
            {completedStep === 2 && "Credit score computed successfully! "}
            <a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer"
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

        {/* ── V3 Step 1: Compute directly ── */}
        {isV3 && step === 1 && (
          <motion.div key="step1-v3"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="glass rounded-xl p-4 border border-success/20 flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="w-4 h-4" /> Wallet registered on EncryptedCreditEngineV3
            </div>

            <div className="glass rounded-2xl p-8 text-center space-y-6">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
                <span className="text-xl">🧮</span>
              </div>
              <div>
                <h3 className="font-heading font-bold text-lg">Compute Credit Score</h3>
                <p className="text-muted-foreground text-sm mt-1">
                  Runs the FHE scoring formula on-chain. Score is computed in the encrypted domain
                  — no plaintext is ever exposed.
                </p>
              </div>

              <div className="glass rounded-xl p-4 border border-primary/10 text-xs text-muted-foreground text-left space-y-1">
                <div className="font-semibold text-primary mb-2">What happens on-chain:</div>
                <div>1. <code className="bg-muted px-1 rounded">FHE.gte(encCreditScore, threshold)</code> → <code className="bg-muted px-1 rounded">ebool</code></div>
                <div>2. <code className="bg-muted px-1 rounded">FHE.decrypt(ebool)</code> → async decryption</div>
                <div>3. <code className="bg-muted px-1 rounded">getDecryptResultSafe()</code> → poll until ready</div>
                <div>4. Score stored as <code className="bg-muted px-1 rounded">euint32</code> ciphertext handle</div>
              </div>

              <Button onClick={handleComputeV3} disabled={loading}
                className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 px-8">
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Computing on-chain…</>
                  : <>Compute Score On-Chain <ArrowRight className="w-4 h-4" /></>
                }
              </Button>
            </div>
          </motion.div>
        )}

        {/* ── V1 Step 1: Submit data ── */}
        {!isV3 && step === 1 && (
          <motion.div key="step1-v1"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="glass rounded-xl p-4 border border-success/20 flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="w-4 h-4" /> Wallet registered successfully
            </div>

            <div className="grid gap-4">
              {[
                { key: "income",            label: "Annual Income (ETH)",   hint: "e.g. 5.0 — converted to wei on-chain" },
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
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirming in wallet…</>
                : <>Submit Data On-Chain <ArrowRight className="w-4 h-4" /></>
              }
            </Button>
          </motion.div>
        )}

        {/* ── V1 Step 2: Compute score ── */}
        {!isV3 && step === 2 && (
          <motion.div key="step2-v1"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="glass rounded-xl p-4 border border-success/20 flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="w-4 h-4" /> Credit data submitted successfully
            </div>

            <div className="glass rounded-2xl p-8 text-center space-y-6">
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
                  <div className="flex gap-3 justify-center flex-wrap">
                    {!profile.isDecrypted && (
                      <Button variant="outline" size="sm" onClick={requestDecryption} disabled={loading}>
                        {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                        Request Decryption
                      </Button>
                    )}
                    {profile.isDecrypted && (
                      <div className="text-xs text-success flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Score decrypted
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-5xl font-bold font-heading text-primary">{preview}</div>
                  <p className="text-muted-foreground">Estimated score. Click to compute on-chain.</p>
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

        {/* ── V3 Score result ── */}
        {isV3 && step >= 2 && (
          <motion.div key="step2-v3"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="glass rounded-xl p-4 border border-success/20 flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="w-4 h-4" /> Score computed on EncryptedCreditEngineV3
            </div>

            <div className="glass rounded-2xl p-8 text-center space-y-6">
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
                  {profile.scoreHistoryLength > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {profile.scoreHistoryLength} encrypted snapshot{profile.scoreHistoryLength > 1 ? "s" : ""} in history
                    </div>
                  )}
                  {/* V3: FHE decryption not available on Base Sepolia */}
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                    🔐 Score stored as FHE ciphertext — decryption requires Fhenix Helium network
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <p className="text-muted-foreground text-sm">
                    Score computed and stored as FHE ciphertext on-chain.
                    Decryption requires Fhenix Helium network.
                  </p>
                  <div className="text-xs text-muted-foreground">
                    🔐 Encrypted — use <code className="bg-muted px-1 rounded">cofhejs.unseal()</code> on Fhenix Helium to read
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
