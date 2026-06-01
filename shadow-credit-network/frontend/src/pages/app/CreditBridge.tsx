import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import {
  ArrowRightLeft, Send, AlertTriangle,
  CheckCircle2, Loader2, RefreshCw, Globe, ExternalLink, Eye,
} from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { useCrossChainBridge } from "@/hooks/useCrossChainBridge";
import { useCreditEngine } from "@/hooks/useCreditEngine";
import { parseContractError } from "@/lib/contracts";
import { cn } from "@/lib/utils";

// LZ endpoint IDs for common testnets
const KNOWN_EIDS: { eid: number; label: string }[] = [
  { eid: 40161, label: "Ethereum Sepolia" },
  { eid: 40231, label: "Arbitrum Sepolia" },
  { eid: 40232, label: "Base Sepolia" },
  { eid: 40245, label: "Optimism Sepolia" },
  { eid: 40168, label: "Polygon Amoy" },
  { eid: 40216, label: "Avalanche Fuji" },
  { eid: 40273, label: "BNB Testnet" },
  { eid: 40280, label: "Fhenix Helium" },
];

const TIER_BADGES = [
  { label: "Unrated",      color: "bg-muted text-muted-foreground" },
  { label: "Deep Subprime", color: "bg-destructive/10 text-destructive" },
  { label: "Subprime",      color: "bg-warning/10 text-warning" },
  { label: "Near Prime",    color: "bg-primary/10 text-primary" },
  { label: "Prime",         color: "bg-success/10 text-success" },
];

export default function CreditBridge() {
  const { isConnected, address } = useWallet();
  const {
    bridgeState, receivedScore, loading, error, txHash, quotedFee,
    loadBridgeState, loadReceivedScore, sendScore, quoteSend,
    clearError, hasAddress, getReadContract,
  } = useCrossChainBridge();

  const {
    requestDecryption, publishScore,
    loading: engineLoading, error: engineError,
  } = useCreditEngine();
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);
  const [published, setPublished] = useState(false);
  const [pubLoading, setPubLoading] = useState(false);

  const handleDecryptAndPublish = async () => {
    setPubLoading(true);
    const score = await requestDecryption();
    if (score !== null) {
      setDecryptedScore(score);
      await publishScore(score);
      setPublished(true);
    }
    setPubLoading(false);
  };

  const [dstEid, setDstEid] = useState<number>(0);
  const [lookupUser, setLookupUser] = useState("");
  const [lookupResult, setLookupResult] = useState<{
    score: number; tier: number; tierLabel: string; valid: boolean;
    expiresAt: number; computedAt: number; srcEid: number;
  } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (isConnected && address) {
      loadBridgeState();
      loadReceivedScore();
    }
  }, [isConnected, address]);

  // Set a sensible default destination that isn't the local chain
  useEffect(() => {
    if (bridgeState.localEid && !dstEid) {
      const other = KNOWN_EIDS.find(e => e.eid !== bridgeState.localEid);
      if (other) setDstEid(other.eid);
    }
  }, [bridgeState.localEid, dstEid]);

  useEffect(() => {
    // Only auto-quote if bridge is fully set up — endpoint + trusted remote.
    // If not configured, quoteSend will revert from the LZ endpoint.
    if (hasAddress && dstEid && isConnected && dstEid !== bridgeState.localEid && bridgeState.hasEndpoint) {
      quoteSend(dstEid);
    }
  }, [dstEid, hasAddress, isConnected, bridgeState.localEid, bridgeState.hasEndpoint]);

  const handleSend = async () => {
    if (dstEid === bridgeState.localEid) return;
    await sendScore(dstEid);
    // Re-fetch after sending
    loadReceivedScore();
  };

  const handleLookup = async () => {
    if (!lookupUser) return;
    setLookupError(null);
    setLookupResult(null);
    setLookupLoading(true);
    try {
      if (!ethers.isAddress(lookupUser)) {
        setLookupError("Invalid address — enter a valid 0x address.");
        return;
      }
      const contract = getReadContract();
      if (!contract) return;
      const rec = await contract.receivedScores(lookupUser);
      const exists = rec.exists ?? false;
      if (!exists) {
        setLookupError("No bridged score found for this address.");
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const valid = now <= Number(rec.expiresAt);
      setLookupResult({
        score: Number(rec.score),
        tier: Number(rec.tier),
        tierLabel: ["Unrated", "Deep Subprime", "Subprime", "Near Prime", "Prime"][Number(rec.tier)] ?? "Unknown",
        valid,
        expiresAt: Number(rec.expiresAt),
        computedAt: Number(rec.computedAt),
        srcEid: Number(rec.srcEid),
      });
    } catch (err: any) {
      const msg = parseContractError(err);
      setLookupError(msg);
    } finally {
      setLookupLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass rounded-2xl p-12 text-center space-y-4">
          <div className="text-4xl">🌉</div>
          <h2 className="text-2xl font-bold font-heading">Connect Your Wallet</h2>
          <p className="text-muted-foreground">Connect to bridge credit scores across chains.</p>
        </div>
      </div>
    );
  }

  if (!hasAddress) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass rounded-2xl p-12 text-center space-y-4">
          <Globe className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-2xl font-bold font-heading">Bridge Not Deployed</h2>
          <p className="text-muted-foreground">The CrossChainCreditBridge contract address is not configured.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-heading">Cross-Chain Credit Bridge</h1>
          <p className="text-muted-foreground mt-1">
            Send your decrypted credit score to other chains via LayerZero
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { loadBridgeState(); loadReceivedScore(); }} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Bridge status */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="glass rounded-xl p-3">
          <div className="text-xs text-muted-foreground">Local Chain EID</div>
          <div className="text-lg font-bold font-heading mt-0.5">{bridgeState.localEid ?? "—"}</div>
        </div>
        <div className="glass rounded-xl p-3">
          <div className="text-xs text-muted-foreground">Credit Engine</div>
          <div className={cn("text-lg font-bold font-heading mt-0.5", bridgeState.hasEngine ? "text-success" : "text-destructive")}>
            {bridgeState.hasEngine ? "Connected" : "Missing"}
          </div>
        </div>
        <div className="glass rounded-xl p-3">
          <div className="text-xs text-muted-foreground">LZ Endpoint</div>
          <div className={cn("text-lg font-bold font-heading mt-0.5", bridgeState.hasEndpoint ? "text-success" : "text-destructive")}>
            {bridgeState.hasEndpoint ? "Connected" : "Missing"}
          </div>
        </div>
      </div>

      {/* Current received score */}
      {receivedScore?.exists && (
        <div className={cn("glass rounded-xl p-4 border", receivedScore.valid ? "border-success/20" : "border-warning/30")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className={cn("w-5 h-5", receivedScore.valid ? "text-success" : "text-warning")} />
              <div>
                <div className="font-semibold">
                  Bridged Score: {receivedScore.score}
                  <span className={cn("ml-2 text-xs px-1.5 py-0.5 rounded-full", TIER_BADGES[receivedScore.tier]?.color ?? "")}>
                    {receivedScore.tierLabel}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  From EID {receivedScore.srcEid} · Computed {new Date(receivedScore.computedAt * 1000).toLocaleDateString()}
                </div>
              </div>
            </div>
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-semibold",
              receivedScore.valid
                ? "bg-success/10 text-success border border-success/20"
                : "bg-warning/10 text-warning border border-warning/30")}>
              {receivedScore.valid ? "Valid" : "Expired"}
            </span>
          </div>
        </div>
      )}

      {/* Bridge not configured warning */}
      {(!bridgeState.hasEndpoint || !bridgeState.hasEngine) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="glass rounded-xl p-4 border border-warning/30 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <div className="text-xs space-y-1">
            <div className="font-semibold text-warning">Bridge not fully configured</div>
            <p className="text-muted-foreground">
              {!bridgeState.hasEndpoint && "LayerZero endpoint not set. "}
              {!bridgeState.hasEngine && "Credit engine not set. "}
              The contract owner must call <code className="bg-muted px-1 rounded">setEndpoint()</code>,{" "}
              <code className="bg-muted px-1 rounded">setCreditEngine()</code>, and{" "}
              <code className="bg-muted px-1 rounded">setTrustedRemote(dstEid, addr)</code> before bridging is available.
              Fee quotes and sends will revert until this is done.
            </p>
          </div>
        </motion.div>
      )}

      {/* Error / tx */}
      {error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="glass rounded-xl p-4 border border-destructive/30 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1 text-sm text-destructive">{error}</div>
          <button onClick={clearError} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
        </motion.div>
      )}
      {txHash && !error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="glass rounded-xl p-3 border border-success/30 flex items-center gap-2 text-xs text-success">
          <CheckCircle2 className="w-4 h-4" />
          Score sent — tx:
          <a href={`https://sepolia.arbiscan.io/tx/${txHash}`} target="_blank" rel="noreferrer"
            className="underline font-mono text-primary">{txHash.slice(0, 20)}…</a>
        </motion.div>
      )}

      {/* Publish score */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-primary" />
          <h2 className="font-heading font-semibold">1. Publish Your Score</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          The CoFHE TaskManager on Arbitrum Sepolia does not support on-chain <code>FHE.decrypt()</code>.
          SDK-decrypt your score in-browser, then publish it on-chain for bridging.
        </p>

        {decryptedScore !== null && (
          <div className="text-sm font-semibold">
            Decrypted score: {decryptedScore}
            {published && <span className="text-success ml-2">✓ Published on-chain</span>}
          </div>
        )}

        {engineError && (
          <div className="text-sm text-destructive">{engineError}</div>
        )}

        <Button onClick={handleDecryptAndPublish} disabled={pubLoading || published}
          className="gap-2">
          {pubLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          {published ? "Score Published" : "Decrypt & Publish Score"}
        </Button>
      </div>

      {/* Send score */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Send className="w-5 h-5 text-primary" />
          <h2 className="font-heading font-semibold">2. Send Score to Another Chain</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Publish your score above first, then select a destination chain.
        </p>

        <div className="flex gap-3 items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm text-muted-foreground">Destination Chain</label>
            <select value={dstEid} onChange={(e) => setDstEid(Number(e.target.value))}
              className="w-full h-10 bg-muted border border-border rounded-lg px-3 text-sm">
              <option value="">Select destination…</option>
              {KNOWN_EIDS.map((e) => (
                <option key={e.eid} value={e.eid}>{e.label} (EID {e.eid})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Est. Fee</label>
            <div className="h-10 flex items-center px-3 bg-muted rounded-lg text-sm font-mono">
              {quotedFee !== null ? `${Number(ethers.formatEther(quotedFee)).toFixed(6)} ETH` : "—"}
            </div>
          </div>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 h-10"
            disabled={loading || !dstEid || !published || !bridgeState.hasEndpoint} onClick={handleSend}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            Send Score
          </Button>
        </div>
      </div>

      {/* Lookup remote score */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-primary" />
          <h2 className="font-heading font-semibold">Look Up Bridged Score</h2>
        </div>
        <div className="flex gap-3 items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm text-muted-foreground">User Address</label>
            <input placeholder="0x…" value={lookupUser}
              onChange={(e) => setLookupUser(e.target.value)}
              className="w-full h-10 bg-muted border border-border rounded-lg px-3 text-sm font-mono" />
          </div>
          <Button variant="outline" className="h-10 gap-2"
            disabled={lookupLoading || !lookupUser} onClick={handleLookup}>
            {lookupLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-4 h-4" />}
            Look Up
          </Button>
        </div>

        {lookupError && (
          <div className="rounded-xl p-4 border border-destructive/30 bg-destructive/5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <span className="text-sm text-destructive">{lookupError}</span>
            </div>
          </div>
        )}

        {lookupResult && (
          <div className={cn("rounded-xl p-4 border", lookupResult.valid ? "border-success/20 bg-success/5" : "border-warning/30 bg-warning/5")}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold">Score: {lookupResult.score}</span>
              <span className={cn("text-xs px-2 py-0.5 rounded-full", TIER_BADGES[lookupResult.tier]?.color ?? "")}>
                {lookupResult.tierLabel}
              </span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Source EID: {lookupResult.srcEid}</div>
              <div>Computed: {new Date(lookupResult.computedAt * 1000).toLocaleDateString()}</div>
              <div>Expires: {new Date(lookupResult.expiresAt * 1000).toLocaleDateString()}</div>
              <div className={lookupResult.valid ? "text-success" : "text-warning"}>
                {lookupResult.valid ? "✓ Valid" : "✗ Expired"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

