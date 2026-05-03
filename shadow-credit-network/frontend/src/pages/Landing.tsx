import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/lib/wallet";
import {
  Shield,
  BarChart3,
  Wallet,
  Handshake,
  Star,
  ArrowRight,
  Zap,
  Lock,
  Globe,
  Plug,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.6 },
  }),
};

const features = [
  {
    icon: BarChart3,
    title: "Credit Dashboard",
    desc: "View your on-chain credit score (300–850), risk tier, and registration status — all derived from smart contract state.",
    color: "from-primary to-primary/60",
  },
  {
    icon: Shield,
    title: "Submit & Compute",
    desc: "Submit income, debt, payment history, utilization, account age, and defaults. Three on-chain transactions — register, submit, compute — with a live score preview.",
    color: "from-accent to-accent/60",
  },
  {
    icon: Wallet,
    title: "Lending & Borrowing",
    desc: "Fund liquidity pools, request auto-approved loans across Conservative, Moderate, and Aggressive risk pools, and track repayments in real time.",
    color: "from-success to-success/60",
  },
  {
    icon: Handshake,
    title: "Credit Delegation",
    desc: "Delegators create yield-bearing offers. Borrowers accept bonds with partial repayment support. Full lifecycle management on-chain.",
    color: "from-warning to-warning/60",
  },
  {
    icon: Star,
    title: "Reputation System",
    desc: "Six weighted factors — Transaction Reliability, Staking, Governance, Protocol Interaction, Social Verification, Default History — with FHE-encrypted composite scoring.",
    color: "from-primary to-accent",
  },
];

const stats = [
  { value: "300–850", label: "Credit Score Range" },
  { value: "3 Pools", label: "Risk Categories" },
  { value: "FHE", label: "Encrypted Scoring" },
  { value: "6", label: "Reputation Factors" },
];

export default function Landing() {
  const navigate = useNavigate();
  const { isConnected, connect, isConnecting } = useWallet();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Hero */}
      <section ref={heroRef} className="relative min-h-screen flex items-center justify-center bg-gradient-hero">
        {/* Grid bg */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: `linear-gradient(hsl(175 80% 50%) 1px, transparent 1px), linear-gradient(90deg, hsl(175 80% 50%) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }} />

        <motion.div
          style={{ y: heroY, opacity: heroOpacity }}
          className="relative z-10 text-center px-6 max-w-4xl mx-auto"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Logo image */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="flex justify-center mb-6"
            >
              <img
                src="/logo.png"
                alt="Shadow Credit Network"
                className="w-28 h-28 md:w-36 md:h-36 rounded-2xl object-cover shadow-2xl"
                style={{ boxShadow: "0 0 60px hsl(175 80% 50% / 0.25), 0 0 120px hsl(260 60% 60% / 0.15)" }}
              />
            </motion.div>

            <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-2 mb-8 text-sm text-muted-foreground">
              <Zap className="w-4 h-4 text-primary" />
              Privacy-Preserving Credit Infrastructure
            </div>
            <h1 className="text-5xl md:text-7xl font-bold font-heading tracking-tight mb-6">
              <span className="text-gradient">Shadow</span>{" "}
              <span className="text-foreground">Credit</span>
              <br />
              <span className="text-foreground">Network</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Submit financial data, compute your credit score, borrow from risk-tiered pools,
              delegate credit, and build reputation — all secured by smart contracts and FHE encryption.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            {isConnected ? (
              <Button
                size="lg"
                onClick={() => navigate("/app")}
                className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary text-base px-8 py-6 rounded-xl font-heading font-semibold gap-2"
              >
                Open Dashboard <ArrowRight className="w-5 h-5" />
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={async () => { await connect(); navigate("/app"); }}
                disabled={isConnecting}
                className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary text-base px-8 py-6 rounded-xl font-heading font-semibold gap-2"
              >
                <Plug className="w-5 h-5" />
                {isConnecting ? "Connecting…" : "Connect & Launch"}
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="border-border hover:bg-secondary text-foreground text-base px-8 py-6 rounded-xl font-heading font-semibold gap-2"
            >
              Explore Features
            </Button>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.6 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-16"
          >
            {stats.map((s) => (
              <div key={s.label} className="glass rounded-xl p-4">
                <div className="text-2xl font-bold font-heading text-primary">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          animate={{ y: [0, 12, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex justify-center pt-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section id="features" className="py-32 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-20"
          >
            <motion.h2 variants={fadeUp} custom={0} className="text-4xl md:text-5xl font-bold font-heading mb-4">
              How It <span className="text-gradient">Works</span>
            </motion.h2>
            <motion.p variants={fadeUp} custom={1} className="text-muted-foreground max-w-xl mx-auto text-lg">
              Five core modules powered by smart contracts, each with a dedicated interface.
            </motion.p>
          </motion.div>

          <div className="space-y-24">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-80px" }}
                className={`flex flex-col md:flex-row items-center gap-12 ${i % 2 === 1 ? "md:flex-row-reverse" : ""}`}
              >
                <motion.div variants={fadeUp} custom={0} className="flex-1">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-6`}>
                    <f.icon className="w-8 h-8 text-primary-foreground" />
                  </div>
                  <h3 className="text-3xl font-bold font-heading mb-4">{f.title}</h3>
                  <p className="text-muted-foreground text-lg leading-relaxed">{f.desc}</p>
                </motion.div>

                <motion.div
                  variants={fadeUp}
                  custom={1}
                  className="flex-1 w-full"
                >
                  <FeatureVisual index={i} />
                </motion.div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section className="py-32 px-6 bg-gradient-hero">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }}>
            <motion.h2 variants={fadeUp} custom={0} className="text-4xl md:text-5xl font-bold font-heading mb-6">
              Built for <span className="text-gradient">Trust</span>
            </motion.h2>
            <motion.div variants={fadeUp} custom={1} className="grid md:grid-cols-3 gap-8 mt-16">
              {[
                { icon: Lock, title: "FHE Encryption", desc: "Scores computed on encrypted data — your financials never exposed on-chain" },
                { icon: Globe, title: "Fully On-Chain", desc: "Every score, loan, bond, and attestation lives transparently on the blockchain" },
                { icon: Zap, title: "Auto-Approval", desc: "Loans approved instantly if your credit score meets the pool threshold" },
              ].map((item) => (
                <div key={item.title} className="glass rounded-2xl p-8 text-left">
                  <item.icon className="w-10 h-10 text-primary mb-4" />
                  <h3 className="text-xl font-bold font-heading mb-2">{item.title}</h3>
                  <p className="text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto text-center glass rounded-3xl p-16 glow-primary"
        >
          <h2 className="text-4xl font-bold font-heading mb-4">Ready to build your on-chain credit?</h2>
          <p className="text-muted-foreground text-lg mb-8">
            Register, submit your data, and get your credit score in minutes.
          </p>
          {isConnected ? (
            <Button
              size="lg"
              onClick={() => navigate("/app")}
              className="bg-primary text-primary-foreground hover:bg-primary/90 text-base px-10 py-6 rounded-xl font-heading font-semibold gap-2"
            >
              Open Dashboard <ArrowRight className="w-5 h-5" />
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={async () => { await connect(); navigate("/app"); }}
              disabled={isConnecting}
              className="bg-primary text-primary-foreground hover:bg-primary/90 text-base px-10 py-6 rounded-xl font-heading font-semibold gap-2"
            >
              <Plug className="w-5 h-5" />
              {isConnecting ? "Connecting…" : "Connect Wallet & Start"}
            </Button>
          )}
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex justify-between items-center text-sm text-muted-foreground">
          <span className="font-heading font-semibold text-foreground">Shadow Credit Network</span>
          <span>Privacy-preserving credit infrastructure</span>
        </div>
      </footer>
    </div>
  );
}

function FeatureVisual({ index }: { index: number }) {
  const visuals = [
    // Dashboard
    <div className="glass rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Credit Score</span>
        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">Prime</span>
      </div>
      <motion.div
        initial={{ scale: 0 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.3, type: "spring", stiffness: 100 }}
        className="w-32 h-32 mx-auto rounded-full border-4 border-primary flex items-center justify-center"
      >
        <span className="text-4xl font-bold font-heading text-primary">782</span>
      </motion.div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-muted rounded-lg p-3"><span className="text-xs text-muted-foreground">Status</span><div className="font-semibold text-sm text-success">Registered</div></div>
        <div className="bg-muted rounded-lg p-3"><span className="text-xs text-muted-foreground">Risk Tier</span><div className="font-semibold text-sm">Prime</div></div>
      </div>
    </div>,
    // Submit
    <div className="glass rounded-2xl p-6 space-y-3">
      <div className="flex gap-2 mb-4">
        {["Register", "Submit", "Compute"].map((step, si) => (
          <div key={step} className={`flex-1 h-2 rounded-full ${si <= 1 ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>
      {["Income (ETH)", "Total Debt", "Payment History", "Utilization", "Account Age", "Defaults"].map((f) => (
        <div key={f} className="flex justify-between items-center bg-muted rounded-lg px-4 py-2.5">
          <span className="text-xs text-muted-foreground">{f}</span>
          <div className="w-16 h-2 bg-primary/20 rounded" />
        </div>
      ))}
      <div className="text-center mt-4 text-sm text-muted-foreground">Est. Score: <span className="text-primary font-bold">~745</span></div>
    </div>,
    // Borrow
    <div className="glass rounded-2xl p-6 space-y-3">
      {[
        { name: "Conservative", apr: "3%", score: "740+", color: "text-success" },
        { name: "Moderate", apr: "8%", score: "670+", color: "text-warning" },
        { name: "Aggressive", apr: "15%", score: "580+", color: "text-destructive" },
      ].map((pool) => (
        <motion.div
          key={pool.name}
          whileHover={{ scale: 1.02 }}
          className="bg-muted rounded-xl p-4 flex justify-between items-center cursor-pointer"
        >
          <div>
            <div className="font-semibold text-sm">{pool.name}</div>
            <div className="text-xs text-muted-foreground">Min Score: {pool.score}</div>
          </div>
          <div className={`font-bold font-heading ${pool.color}`}>{pool.apr} APR</div>
        </motion.div>
      ))}
      <div className="bg-muted/50 rounded-xl p-3 text-xs text-muted-foreground text-center">
        Auto-approved if score meets threshold
      </div>
    </div>,
    // Delegation
    <div className="glass rounded-2xl p-6 space-y-4">
      <div className="flex gap-4">
        <div className="flex-1 bg-muted rounded-xl p-4">
          <div className="text-xs text-muted-foreground mb-2">Delegator</div>
          <div className="text-sm font-semibold">Create Offer</div>
          <div className="text-xs text-muted-foreground mt-1">Set yield, min score, max bonds</div>
        </div>
        <div className="flex items-center">
          <ArrowRight className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 bg-muted rounded-xl p-4">
          <div className="text-xs text-muted-foreground mb-2">Borrower</div>
          <div className="text-sm font-semibold">Accept Bond</div>
          <div className="text-xs text-muted-foreground mt-1">Partial repayment supported</div>
        </div>
      </div>
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs text-primary text-center">
        Yield accrues automatically on-chain
      </div>
    </div>,
    // Reputation
    <div className="glass rounded-2xl p-6 space-y-3">
      {[
        { name: "Transaction Reliability", weight: 30 },
        { name: "Staking History", weight: 20 },
        { name: "Governance", weight: 15 },
        { name: "Protocol Interaction", weight: 15 },
        { name: "Social Verification", weight: 10 },
        { name: "Default History", weight: 10 },
      ].map((factor) => (
        <div key={factor.name} className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-36 shrink-0">{factor.name}</span>
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: `${factor.weight * 3.3}%` }}
              viewport={{ once: true }}
              transition={{ delay: 0.3, duration: 0.8 }}
              className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
            />
          </div>
          <span className="text-xs font-semibold w-8 text-right">{factor.weight}%</span>
        </div>
      ))}
    </div>,
  ];
  return visuals[index];
}
