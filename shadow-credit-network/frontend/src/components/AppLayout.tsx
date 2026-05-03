import { NavLink, Outlet } from "react-router-dom";
import { BarChart3, Send, Wallet, Handshake, Star, Plug, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/lib/wallet";
import { Button } from "@/components/ui/button";
import { ADDRESSES } from "@/lib/contracts";

const navItems = [
  { to: "/app",            icon: BarChart3, label: "Dashboard",  end: true },
  { to: "/app/submit",     icon: Send,      label: "Submit Data" },
  { to: "/app/borrow",     icon: Wallet,    label: "Borrow" },
  { to: "/app/delegation", icon: Handshake, label: "Delegation" },
  { to: "/app/reputation", icon: Star,      label: "Reputation" },
];

export default function AppLayout() {
  const { address, isConnected, isConnecting, isWrongNetwork, connect, disconnect, switchNetwork, error } = useWallet();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-border bg-sidebar p-4 flex flex-col gap-2 sticky top-0 h-screen overflow-y-auto">
        <NavLink to="/" className="flex items-center gap-2 px-3 py-3 mb-2">
          <img src="/logo.png" alt="Shadow Credit Network" className="w-8 h-8 rounded-lg object-cover" />
          <span className="font-heading font-bold text-sm text-foreground leading-tight">Shadow Credit</span>
        </NavLink>

        {/* Network badge */}
        <div className="px-3 mb-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className={cn("w-2 h-2 rounded-full", isConnected && !isWrongNetwork ? "bg-success" : "bg-muted-foreground")} />
            Base Sepolia
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Contract version badges */}
        <div className="mt-auto px-3 pb-2 space-y-1">
          <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">Contracts</div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Credit Engine</span>
            <span className={cn("px-1.5 py-0.5 rounded text-xs font-mono", ADDRESSES.isV3Engine ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
              {ADDRESSES.isV3Engine ? "V3" : "V1"}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Loan Pool</span>
            <span className={cn("px-1.5 py-0.5 rounded text-xs font-mono", ADDRESSES.isV3Pool ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
              {ADDRESSES.isV3Pool ? "V3" : "V1"}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Delegation</span>
            <span className={cn("px-1.5 py-0.5 rounded text-xs font-mono", ADDRESSES.isV2Delegation ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
              {ADDRESSES.isV2Delegation ? "V2" : "V1"}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Reputation</span>
            <span className={cn("px-1.5 py-0.5 rounded text-xs font-mono", ADDRESSES.reputation ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
              {ADDRESSES.reputation ? "Live" : "—"}
            </span>
          </div>
        </div>

        {/* Wallet section */}
        <div className="border-t border-border pt-3 px-1">
          {isWrongNetwork ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-warning px-2">
                <AlertTriangle className="w-3 h-3" />
                Wrong network
              </div>
              <Button size="sm" variant="outline" className="w-full text-xs" onClick={switchNetwork}>
                Switch to Base Sepolia
              </Button>
            </div>
          ) : isConnected && address ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-2">
                <div className="w-2 h-2 rounded-full bg-success" />
                <span className="text-xs font-mono text-foreground truncate">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </span>
              </div>
              <Button size="sm" variant="ghost" className="w-full text-xs text-muted-foreground" onClick={disconnect}>
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs gap-2"
              onClick={connect}
              disabled={isConnecting}
            >
              <Plug className="w-3 h-3" />
              {isConnecting ? "Connecting…" : "Connect Wallet"}
            </Button>
          )}
          {error && <p className="text-xs text-destructive mt-1 px-2">{error}</p>}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
