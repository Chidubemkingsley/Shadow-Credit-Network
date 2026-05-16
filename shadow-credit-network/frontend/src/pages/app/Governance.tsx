import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Vote, Plus, CheckCircle, XCircle, Clock, Gavel, Shield, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/lib/wallet";
import { getGovernanceContract, ADDRESSES } from "@/lib/contracts";
import { parseContractError } from "@/lib/contracts";

// ── Types ──────────────────────────────────────────────────────────────────────
const PROPOSAL_TYPES = [
  { value: 0, label: "Signal" },
  { value: 1, label: "Update Score Validity" },
  { value: 2, label: "Pause Pool" },
  { value: 3, label: "Update Min Vote Score" },
  { value: 4, label: "Update Voting Period" },
  { value: 5, label: "Update Execution Delay" },
] as const;

const STATE_LABELS = ["Active", "Passed", "Defeated", "Queued", "Executed", "Cancelled"] as const;

type ProposalState = typeof STATE_LABELS[number];

interface OnChainProposal {
  id: number;
  proposer: string;
  proposalType: number;
  param: bigint;
  description: string;
  voteStart: bigint;
  voteEnd: bigint;
  forVotes: bigint;
  againstVotes: bigint;
  voterCount: bigint;
  state: number;
  executableAt: bigint;
}

function stateLabel(s: number): ProposalState { return STATE_LABELS[s] ?? "Active"; }
function stateColor(s: number) {
  return ["bg-success/10 text-success border-success/20","bg-primary/10 text-primary border-primary/20","bg-destructive/10 text-destructive border-destructive/20","bg-warning/10 text-warning border-warning/20","bg-muted text-muted-foreground border-border","bg-muted text-muted-foreground border-border"][s] ?? "";
}
function stateIcon(s: number) {
  if (s === 0) return <Clock className="w-3 h-3"/>;
  if (s === 1) return <CheckCircle className="w-3 h-3"/>;
  if (s === 2) return <XCircle className="w-3 h-3"/>;
  if (s === 3) return <Gavel className="w-3 h-3"/>;
  return null;
}
function fmtDate(ts: bigint) {
  return new Date(Number(ts) * 1000).toLocaleDateString();
}

const TIER_WEIGHTS = [
  { label: "Prime",        mult: "4×", color: "text-primary" },
  { label: "Near Prime",   mult: "3×", color: "text-blue-400" },
  { label: "Subprime",     mult: "2×", color: "text-warning" },
  { label: "Deep Subprime",mult: "1×", color: "text-destructive" },
];

// ── Component ──────────────────────────────────────────────────────────────────
export default function Governance() {
  const { signer, provider, address, isConnected } = useWallet();
  const [proposals, setProposals] = useState<OnChainProposal[]>([]);
  const [loading, setLoading]   = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [error, setError]       = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [votedIds, setVotedIds] = useState<Set<number>>(new Set());
  const [eligibility, setEligibility] = useState<{ eligible: boolean; weight: bigint; tier: number } | null>(null);
  const [canPropose, setCanPropose] = useState(false);
  const [form, setForm] = useState({ type: 0, description: "", param: "" });

  // ── Read proposals from chain ──────────────────────────────────────────────
  const loadProposals = useCallback(async () => {
    const rpc = provider ?? (window.ethereum ? (await import("ethers")).then(e => new e.BrowserProvider(window.ethereum)) : null);
    if (!rpc || !ADDRESSES.governance) return;
    setLoading(true);
    setError("");
    try {
      const gov = getGovernanceContract(rpc as any);
      if (!gov) throw new Error("Governance contract not configured");
      const count = Number(await gov.proposalCount());
      const loaded: OnChainProposal[] = [];
      for (let i = 0; i < count; i++) {
        const p = await gov.getProposal(i);
        loaded.push({ id: Number(p.id), proposer: p.proposer, proposalType: Number(p.proposalType), param: p.param, description: p.description, voteStart: p.voteStart, voteEnd: p.voteEnd, forVotes: p.forVotes, againstVotes: p.againstVotes, voterCount: p.voterCount, state: Number(p.state), executableAt: p.executableAt });
      }
      setProposals(loaded.reverse());
    } catch (e: any) {
      setError(parseContractError(e));
    } finally {
      setLoading(false);
    }
  }, [provider]);

  // ── Check voter eligibility ────────────────────────────────────────────────
  const loadEligibility = useCallback(async () => {
    if (!address || !provider || !ADDRESSES.governance) return;
    try {
      const gov = getGovernanceContract(provider);
      if (!gov) return;
      const [eli, cp] = await Promise.all([gov.isEligibleVoter(address), gov.isEligibleProposer(address)]);
      setEligibility({ eligible: eli.eligible, weight: eli.weight, tier: Number(eli.tier) });
      setCanPropose(cp);
      // Check which proposals current user has voted on
      const voted = new Set<number>();
      for (const p of proposals) {
        const hv = await gov.hasVoted(address, p.id);
        if (hv) voted.add(p.id);
      }
      setVotedIds(voted);
    } catch {}
  }, [address, provider, proposals]);

  useEffect(() => { loadProposals(); }, [loadProposals]);
  useEffect(() => { loadEligibility(); }, [loadEligibility]);

  // ── Propose ────────────────────────────────────────────────────────────────
  async function submitProposal() {
    if (!signer || !ADDRESSES.governance) return;
    setTxLoading(true); setError("");
    try {
      const gov = getGovernanceContract(signer);
      if (!gov) throw new Error("Contract not available");
      const param = form.type === 0 ? 0n : BigInt(form.param || "0");
      const tx = await gov.propose(form.type, param, form.description);
      await tx.wait();
      setShowCreate(false);
      setForm({ type: 0, description: "", param: "" });
      await loadProposals();
    } catch (e: any) {
      setError(parseContractError(e));
    } finally {
      setTxLoading(false);
    }
  }

  // ── Vote ───────────────────────────────────────────────────────────────────
  async function castVote(proposalId: number, support: boolean) {
    if (!signer || !ADDRESSES.governance) return;
    setTxLoading(true); setError("");
    try {
      const gov = getGovernanceContract(signer);
      if (!gov) throw new Error("Contract not available");
      const tx = await gov.castVote(proposalId, support);
      await tx.wait();
      setVotedIds(prev => new Set([...prev, proposalId]));
      await loadProposals();
    } catch (e: any) {
      setError(parseContractError(e));
    } finally {
      setTxLoading(false);
    }
  }

  // ── Lifecycle actions ──────────────────────────────────────────────────────
  async function lifecycleAction(fn: string, proposalId: number) {
    if (!signer || !ADDRESSES.governance) return;
    setTxLoading(true); setError("");
    try {
      const gov = getGovernanceContract(signer);
      if (!gov) throw new Error("Contract not available");
      const tx = await (gov as any)[fn](proposalId);
      await tx.wait();
      await loadProposals();
    } catch (e: any) {
      setError(parseContractError(e));
    } finally {
      setTxLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const tierName = eligibility ? ["Deep Subprime","Subprime","Near Prime","Prime",""][eligibility.tier] ?? "" : "";

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }} className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold font-heading">Governance</h1>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20">Wave 4</span>
          </div>
          <p className="text-muted-foreground">Score-gated proposals. Voting power scales with your credit tier.</p>
          {ADDRESSES.governance && (
            <p className="text-xs font-mono text-muted-foreground mt-1">
              Contract: <a href={`https://sepolia.basescan.org/address/${ADDRESSES.governance}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{ADDRESSES.governance.slice(0,8)}…{ADDRESSES.governance.slice(-6)}</a>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadProposals} disabled={loading} className="gap-1">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => setShowCreate(!showCreate)} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90" disabled={!isConnected || !canPropose}>
            <Plus className="w-4 h-4"/>New Proposal
          </Button>
        </div>
      </motion.div>

      {/* Errors */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0"/>
          {error}
        </div>
      )}

      {/* Eligibility card */}
      <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.15 }}
        className="glass rounded-2xl p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Your Tier</div>
          <div className="font-bold text-sm text-blue-400">{eligibility?.eligible ? tierName : isConnected ? "Not Eligible" : "—"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Voting Power</div>
          <div className="font-bold text-sm text-primary">{eligibility?.eligible ? `${eligibility.weight}×` : "—"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Min Score to Vote</div>
          <div className="font-bold text-sm">580</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Can Propose</div>
          <div className={`font-bold text-sm ${canPropose ? "text-success" : "text-muted-foreground"}`}>{isConnected ? (canPropose ? "Yes" : "No") : "—"}</div>
        </div>
      </motion.div>

      {/* Tier weight breakdown */}
      <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.2 }}
        className="glass rounded-2xl p-6">
        <div className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Vote className="w-4 h-4 text-violet-400"/>Voting Weight by Credit Tier
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {TIER_WEIGHTS.map((t) => (
            <div key={t.label} className={`rounded-xl p-4 text-center border border-border bg-muted/30`}>
              <div className={`text-2xl font-bold font-heading ${t.color}`}>{t.mult}</div>
              <div className="text-xs text-muted-foreground mt-1">{t.label}</div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Create Proposal Form */}
      {showCreate && (
        <motion.div initial={{ opacity:0, y:-10 }} animate={{ opacity:1, y:0 }}
          className="glass rounded-2xl p-6 border border-violet-500/20 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-400"/>Create Proposal
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Proposal Type</label>
              <select className="w-full bg-muted rounded-lg px-3 py-2 text-sm border border-border focus:outline-none focus:border-primary"
                value={form.type} onChange={e => setForm(f => ({ ...f, type: Number(e.target.value) }))}>
                {PROPOSAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {form.type !== 0 && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                  {form.type === 2 ? "1 = Pause / 0 = Unpause" : "New Value"}
                </label>
                <input type="number" placeholder="e.g. 7776000" className="w-full bg-muted rounded-lg px-3 py-2 text-sm border border-border focus:outline-none focus:border-primary"
                  value={form.param} onChange={e => setForm(f => ({ ...f, param: e.target.value }))}/>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Description</label>
            <textarea rows={3} placeholder="Describe the rationale for this proposal..."
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm border border-border focus:outline-none focus:border-primary resize-none"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}/>
          </div>
          <div className="flex gap-3">
            <Button className="bg-violet-600 hover:bg-violet-500 text-white gap-2"
              disabled={!isConnected || !form.description || txLoading} onClick={submitProposal}>
              {txLoading ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Vote className="w-4 h-4"/>}
              {txLoading ? "Submitting…" : "Submit Proposal"}
            </Button>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={txLoading}>Cancel</Button>
          </div>
          {!canPropose && isConnected && (
            <p className="text-xs text-warning">You need a credit score ≥ 670 to propose.</p>
          )}
        </motion.div>
      )}

      {/* Proposals list */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg">All Proposals</h2>
            <p className="text-xs text-muted-foreground mt-0.5">The voting window stays open for exactly 7 days.</p>
          </div>
          <span className="text-xs text-muted-foreground">{loading ? "Loading…" : `${proposals.length} proposal${proposals.length !== 1 ? "s" : ""}`}</span>
        </div>

        {!loading && proposals.length === 0 && (
          <div className="glass rounded-2xl p-12 text-center text-muted-foreground text-sm">
            No proposals yet. Be the first to create one.
          </div>
        )}

        {proposals.map((p, i) => {
          const total = Number(p.forVotes + p.againstVotes);
          const forPct = total > 0 ? (Number(p.forVotes) / total) * 100 : 0;
          const hasVotedOn = votedIds.has(p.id);
          const isExpanded = expanded === p.id;

          return (
            <motion.div key={p.id} initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay: i * 0.04 }}
              className="glass rounded-2xl p-6 space-y-4 cursor-pointer hover:border-primary/30 border border-transparent transition-colors"
              onClick={() => setExpanded(isExpanded ? null : p.id)}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono"># {p.id}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{PROPOSAL_TYPES[p.proposalType]?.label ?? "Signal"}</span>
                  </div>
                  <p className="text-sm font-medium leading-snug">{p.description || "(No description)"}</p>
                  <p className="text-xs text-muted-foreground mt-1">by {p.proposer.slice(0,8)}… · ends {fmtDate(p.voteEnd)}</p>
                </div>
                <span className={`shrink-0 flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${stateColor(p.state)}`}>
                  {stateIcon(p.state)} {stateLabel(p.state)}
                </span>
              </div>

              {/* Vote bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>For: {Number(p.forVotes).toLocaleString()}</span>
                  <span>Against: {Number(p.againstVotes).toLocaleString()}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <motion.div initial={{ width:0 }} animate={{ width:`${forPct}%` }} transition={{ duration:0.8, delay: i*0.04+0.2 }}
                    className="h-full bg-gradient-to-r from-success to-primary rounded-full"/>
                </div>
                <div className="text-xs text-muted-foreground text-right">{total.toLocaleString()} total votes</div>
              </div>

              {/* Expanded actions */}
              {isExpanded && (
                <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }}
                  className="pt-3 border-t border-border flex flex-wrap gap-3 items-center"
                  onClick={e => e.stopPropagation()}>

                  {/* Active: Vote */}
                  {p.state === 0 && (
                    hasVotedOn ? (
                      <div className="flex items-center gap-2 text-sm text-success"><CheckCircle className="w-4 h-4"/>Vote recorded</div>
                    ) : (
                      <>
                        <Button size="sm" className="gap-2 bg-success/10 text-success hover:bg-success/20 border border-success/20"
                          disabled={!isConnected || !eligibility?.eligible || txLoading} onClick={() => castVote(p.id, true)}>
                          {txLoading ? <RefreshCw className="w-3 h-3 animate-spin"/> : <CheckCircle className="w-4 h-4"/>}Vote For
                        </Button>
                        <Button size="sm" className="gap-2 bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20"
                          disabled={!isConnected || !eligibility?.eligible || txLoading} onClick={() => castVote(p.id, false)}>
                          {txLoading ? <RefreshCw className="w-3 h-3 animate-spin"/> : <XCircle className="w-4 h-4"/>}Vote Against
                        </Button>
                        {!eligibility?.eligible && isConnected && <p className="text-xs text-muted-foreground">Submit your credit data to vote.</p>}
                        {!isConnected && <p className="text-xs text-muted-foreground">Connect wallet to vote.</p>}
                        {/* Finalize once voting period ends */}
                        {p.proposer.toLowerCase() === address?.toLowerCase() && (
                          <div className="flex items-center gap-2 w-full mt-2">
                            <Button size="sm" variant="outline" className="text-xs" disabled={txLoading}
                              onClick={() => lifecycleAction("finalize", p.id)}>Finalize</Button>
                            <span className="text-[10px] text-muted-foreground">Only proposer can finalize. Available 7 days after creation.</span>
                          </div>
                        )}
                      </>
                    )
                  )}

                  {/* Passed: Queue */}
                  {p.state === 1 && (
                    <Button size="sm" className="gap-2 bg-warning/10 text-warning hover:bg-warning/20 border border-warning/20"
                      disabled={!isConnected || txLoading} onClick={() => lifecycleAction("queue", p.id)}>
                      <Gavel className="w-4 h-4"/>Queue Proposal
                    </Button>
                  )}

                  {/* Queued: Execute */}
                  {p.state === 3 && (
                    <Button size="sm" className="gap-2 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
                      disabled={!isConnected || txLoading} onClick={() => lifecycleAction("execute", p.id)}>
                      <CheckCircle className="w-4 h-4"/>Execute
                    </Button>
                  )}

                  {txLoading && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground"/>}
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
