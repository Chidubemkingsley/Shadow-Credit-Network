import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet";
import { useDelegation } from "@/hooks/useDelegation";
import { ADDRESSES } from "@/lib/contracts";
import {
  AlertTriangle, CheckCircle2, Loader2, RefreshCw,
  Clock, ArrowRight, TrendingUp, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

function OfferCard({
  offer,
  address,
  onAccept,
  loading,
  isV2,
}: {
  offer: any;
  address: string | null;
  onAccept: (id: number, amount: string, days: number) => void;
  loading: boolean;
  isV2: boolean;
}) {
  const [accepting, setAccepting] = useState(false);
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("30");
  const isOwn = offer.delegator.toLowerCase() === address?.toLowerCase();
  const isFull = offer.activeBonds >= offer.maxBonds || offer.available === 0n;

  return (
    <motion.div
      layout
      whileHover={{ scale: 1.005 }}
      className={cn(
        "glass rounded-xl p-5 border",
        isOwn && "border-primary/20",
        isFull && !isOwn && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">Offer #{offer.id}</span>
            {isOwn && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                Your Offer
              </span>
            )}
            {isFull && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                Full
              </span>
            )}
          </div>

          {/* Delegator address */}
          <div className="text-xs font-mono text-muted-foreground">
            {offer.delegator.slice(0, 10)}…{offer.delegator.slice(-6)}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Amount</span>
              <span className="font-semibold">{ethers.formatEther(offer.maxAmount)} ETH</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available</span>
              <span className={cn("font-semibold", offer.available > 0n ? "text-success" : "text-muted-foreground")}>
                {ethers.formatEther(offer.available)} ETH
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Yield Rate</span>
              <span className="font-semibold text-success">
                {(Number(offer.yieldRate) / 100).toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Min Score</span>
              <span className="font-semibold">{Number(offer.minScore)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bonds</span>
              <span className="font-semibold">{offer.activeBonds}/{offer.maxBonds}</span>
            </div>
          </div>

          {isV2 && (
            <div className="text-xs text-primary">✓ Yield paid directly to delegator on repayment</div>
          )}
        </div>

        {/* Accept action */}
        {!isOwn && !isFull && (
          <div className="shrink-0">
            {accepting ? (
              <div className="space-y-2">
                <div className="flex gap-1">
                  <Input
                    type="number"
                    className="w-24 h-8 text-xs"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="ETH"
                  />
                  <Input
                    type="number"
                    className="w-16 h-8 text-xs"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    placeholder="days"
                  />
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="h-8 text-xs flex-1 bg-primary text-primary-foreground"
                    onClick={() => { onAccept(offer.id, amount, Number(days)); setAccepting(false); }}
                    disabled={loading || !amount}
                  >
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Accept"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAccepting(false)}>✕</Button>
                </div>
                <div className="text-xs text-muted-foreground">Amount + duration</div>
              </div>
            ) : (
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => setAccepting(true)}
              >
                Accept
              </Button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function Delegation() {
  const { isConnected, address } = useWallet();
  const {
    offers, myOffers, myBonds, loading, error, txHash,
    loadOffers, loadMyOffers, loadMyBonds,
    createOffer, cancelOffer, acceptOffer, repayBond, markExpiredDefault,
    clearError, isV2,
  } = useDelegation();

  const [offerData, setOfferData] = useState({
    maxAmount: "0.1",
    yieldRate: "500",
    minScore: "580",
    maxBonds: "5",
  });
  const [repayId, setRepayId] = useState<number | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [activeTab, setActiveTab] = useState("browse");

  useEffect(() => {
    if (isConnected && address) {
      loadOffers();
      loadMyOffers();
      loadMyBonds();
    }
  }, [isConnected, address, loadOffers, loadMyOffers, loadMyBonds]);

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass rounded-2xl p-12 text-center space-y-4">
          <div className="text-4xl">🤝</div>
          <h2 className="text-2xl font-bold font-heading">Connect Your Wallet</h2>
          <p className="text-muted-foreground">Connect to Base Sepolia to access the delegation market.</p>
        </div>
      </div>
    );
  }

  const activeOffers = offers.filter((o) => o.status === 0);
  const myActiveOffers = myOffers.filter((o) => o.status === 0);
  const activeBonds = myBonds.filter((b) => b.status === 0);

  const handleCreateOffer = async () => {
    await createOffer(
      offerData.maxAmount,
      Number(offerData.yieldRate),
      Number(offerData.minScore),
      Number(offerData.maxBonds),
    );
    setActiveTab("browse"); // switch to browse so user sees their offer
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-heading">Credit Delegation</h1>
          <p className="text-muted-foreground mt-1">
            {isV2
              ? "V2: Yield pays out immediately · Bond expiry enforcement · Credit score check"
              : "Create offers or accept bonds"}
          </p>
        </div>
        <Button
          variant="ghost" size="sm"
          onClick={() => { loadOffers(); loadMyOffers(); loadMyBonds(); }}
          disabled={loading}
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Market stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Active Offers", value: String(activeOffers.length), icon: <Users className="w-3 h-3" /> },
          {
            label: "Total Available",
            value: `${Number(ethers.formatEther(
              activeOffers.reduce((s, o) => s + o.available, 0n)
            )).toFixed(3)} ETH`,
            icon: null,
          },
          { label: "My Offers", value: String(myActiveOffers.length), icon: null },
          { label: "My Bonds", value: String(activeBonds.length), icon: null },
        ].map((s) => (
          <div key={s.label} className="glass rounded-xl p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">{s.icon}{s.label}</div>
            <div className="text-lg font-bold font-heading text-primary mt-0.5">{s.value}</div>
          </div>
        ))}
      </div>

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
            <a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" className="underline font-mono text-primary">
              {txHash.slice(0, 20)}…
            </a>
          </motion.div>
        )}
      </AnimatePresence>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted">
          <TabsTrigger value="browse">
            Browse Offers
            {activeOffers.length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                {activeOffers.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="create">Create Offer</TabsTrigger>
          <TabsTrigger value="my-offers">
            My Offers
            {myActiveOffers.length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                {myActiveOffers.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="my-bonds">
            My Bonds
            {activeBonds.length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                {activeBonds.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Browse Offers ── */}
        <TabsContent value="browse" className="mt-6 space-y-3">
          {activeOffers.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center space-y-3">
              <div className="text-muted-foreground">No active offers yet.</div>
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1"
                onClick={() => setActiveTab("create")}
              >
                Create the first offer <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            // Sort by available ETH descending (highest balance first)
            [...activeOffers]
              .sort((a, b) => Number(b.available - a.available))
              .map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  address={address}
                  onAccept={acceptOffer}
                  loading={loading}
                  isV2={isV2}
                />
              ))
          )}
        </TabsContent>

        {/* ── Create Offer ── */}
        <TabsContent value="create" className="mt-6">
          <div className="glass rounded-2xl p-6 space-y-5 max-w-md">
            <div>
              <h3 className="font-heading font-semibold">Create Delegation Offer</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Your offer will appear in Browse Offers immediately after confirmation.
                {isV2 && " Yield transfers directly to your wallet when borrowers repay."}
              </p>
            </div>

            {[
              { key: "maxAmount",  label: "Max Amount (ETH)",                  hint: "Total ETH you're willing to delegate" },
              { key: "yieldRate",  label: "Yield Rate (basis points)",         hint: "500 = 5% yield on repayments" },
              { key: "minScore",   label: "Min Credit Score",                  hint: "Minimum score required from borrowers (300–850)" },
              { key: "maxBonds",   label: "Max Simultaneous Bonds",            hint: "How many bonds can be active at once" },
            ].map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-sm">{f.label}</Label>
                <Input
                  type="number"
                  placeholder={f.hint}
                  value={offerData[f.key as keyof typeof offerData]}
                  onChange={(e) => setOfferData((d) => ({ ...d, [f.key]: e.target.value }))}
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
            ))}

            {/* Preview */}
            {offerData.maxAmount && offerData.yieldRate && (
              <div className="glass rounded-lg p-3 border border-primary/20 text-xs space-y-1">
                <div className="font-semibold text-primary">Offer Preview</div>
                <div className="text-muted-foreground">
                  Delegating <span className="text-foreground">{offerData.maxAmount} ETH</span> at{" "}
                  <span className="text-success">{(Number(offerData.yieldRate) / 100).toFixed(2)}% yield</span>,
                  min score <span className="text-foreground">{offerData.minScore}</span>,
                  up to <span className="text-foreground">{offerData.maxBonds}</span> bonds.
                </div>
              </div>
            )}

            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              disabled={loading || !offerData.maxAmount}
              onClick={handleCreateOffer}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirming in wallet…</>
                : <>Create Offer <ArrowRight className="w-4 h-4" /></>
              }
            </Button>
          </div>
        </TabsContent>

        {/* ── My Offers ── */}
        <TabsContent value="my-offers" className="mt-6 space-y-3">
          {myOffers.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center text-muted-foreground">
              No offers created yet.
            </div>
          ) : (
            myOffers.map((offer) => (
              <div key={offer.id} className="glass rounded-xl p-5 flex items-start justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">Offer #{offer.id}</span>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-semibold",
                      offer.status === 0 ? "bg-success/10 text-success" :
                      offer.status === 1 ? "bg-muted text-muted-foreground" :
                      "bg-muted text-muted-foreground"
                    )}>
                      {offer.statusLabel}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div>Max: {ethers.formatEther(offer.maxAmount)} ETH · Available: {ethers.formatEther(offer.available)} ETH</div>
                    <div>Yield: {(Number(offer.yieldRate) / 100).toFixed(2)}% · Min Score: {Number(offer.minScore)}</div>
                    <div>Bonds: {offer.activeBonds}/{offer.maxBonds}</div>
                  </div>
                </div>
                {offer.status === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0"
                    onClick={() => cancelOffer(offer.id)}
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Cancel"}
                  </Button>
                )}
              </div>
            ))
          )}
        </TabsContent>

        {/* ── My Bonds ── */}
        <TabsContent value="my-bonds" className="mt-6 space-y-3">
          {myBonds.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center text-muted-foreground">
              No bonds yet. Accept an offer to create a bond.
            </div>
          ) : (
            myBonds.map((bond) => {
              const remaining = bond.amount - bond.repaid;
              const progressPct = bond.amount > 0n
                ? Number((bond.repaid * 100n) / bond.amount)
                : 0;

              return (
                <motion.div
                  key={bond.id}
                  layout
                  className={cn(
                    "glass rounded-xl p-5 border",
                    bond.status === 0 && "border-primary/20",
                    bond.status === 1 && "border-success/20",
                    bond.isExpired && "border-destructive/30",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1 min-w-0">
                      {/* Header */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">Bond #{bond.id}</span>
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-semibold",
                          bond.status === 0 ? "bg-primary/10 text-primary" :
                          bond.status === 1 ? "bg-success/10 text-success" :
                          "bg-destructive/10 text-destructive"
                        )}>
                          {bond.statusLabel}
                        </span>
                        {bond.isExpired && (
                          <span className="text-xs text-destructive font-bold flex items-center gap-1">
                            <Clock className="w-3 h-3" /> EXPIRED
                          </span>
                        )}
                      </div>

                      {/* Delegator */}
                      <div className="text-xs text-muted-foreground font-mono">
                        From: {bond.delegator.slice(0, 10)}…{bond.delegator.slice(-6)}
                      </div>

                      {/* Amounts */}
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>Amount: <span className="text-foreground">{ethers.formatEther(bond.amount)} ETH</span></div>
                        <div>Repaid: <span className={bond.repaid > 0n ? "text-success" : "text-foreground"}>{ethers.formatEther(bond.repaid)} ETH</span></div>
                        {bond.status === 0 && remaining > 0n && (
                          <div>Remaining: <span className="text-warning">{ethers.formatEther(remaining)} ETH</span></div>
                        )}
                        <div className="flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 text-success" />
                          Yield earned: <span className="text-success">{ethers.formatEther(bond.yieldEarned)} ETH</span>
                          {isV2 && bond.yieldPaidOut > 0n && (
                            <span className="text-primary ml-1">(paid out: {ethers.formatEther(bond.yieldPaidOut)} ETH)</span>
                          )}
                        </div>
                      </div>

                      {/* Due date */}
                      {isV2 && bond.dueDate > 0n && bond.status === 0 && (
                        <div className={cn("text-xs flex items-center gap-1", bond.isExpired ? "text-destructive" : "text-muted-foreground")}>
                          <Clock className="w-3 h-3" />
                          Due: {new Date(Number(bond.dueDate) * 1000).toLocaleDateString()}
                        </div>
                      )}

                      {/* Progress bar */}
                      {bond.status === 0 && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Repayment progress</span>
                            <span>{progressPct}%</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-500"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 shrink-0">
                      {bond.status === 0 && !bond.isExpired && (
                        repayId === bond.id ? (
                          <div className="flex gap-1">
                            <Input
                              type="number"
                              className="w-24 h-8 text-xs"
                              value={repayAmount}
                              onChange={(e) => setRepayAmount(e.target.value)}
                              placeholder="ETH"
                            />
                            <Button
                              size="sm"
                              className="h-8 text-xs bg-primary text-primary-foreground"
                              onClick={() => repayBond(bond.id, repayAmount)}
                              disabled={loading}
                            >
                              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "✓"}
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-8 text-xs"
                              onClick={() => { setRepayId(null); setRepayAmount(""); }}
                            >✕</Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                            onClick={() => {
                              setRepayId(bond.id);
                              setRepayAmount(ethers.formatEther(remaining));
                            }}
                          >
                            Repay
                          </Button>
                        )
                      )}

                      {bond.status === 1 && (
                        <div className="text-xs text-success flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Repaid
                        </div>
                      )}

                      {isV2 && bond.isExpired && bond.status === 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs text-destructive border-destructive/30"
                          onClick={() => markExpiredDefault(bond.id)}
                          disabled={loading}
                        >
                          Mark Defaulted
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
