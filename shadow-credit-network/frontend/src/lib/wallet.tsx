import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { ethers } from "ethers";

// ── Network config ────────────────────────────────────────────────────────────
const REQUIRED_CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID ?? "84532");

// CoFHE-enabled networks: Fhenix Helium (8008135) and localcofhe (412346)
// Base Sepolia (84532) does NOT have the CoFHE task manager deployed.
const COFHE_CHAIN_IDS = new Set([8008135, 412346]);
export const isCoFHENetwork = (chainId: number | null): boolean =>
  chainId !== null && COFHE_CHAIN_IDS.has(chainId);

const REQUIRED_CHAIN = {
  chainId: `0x${REQUIRED_CHAIN_ID.toString(16)}`,
  chainName: "Base Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: [import.meta.env.VITE_RPC_URL ?? "https://sepolia.base.org"],
  blockExplorerUrls: [import.meta.env.VITE_BLOCK_EXPLORER ?? "https://sepolia.basescan.org"],
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface WalletState {
  address: string | null;
  provider: ethers.BrowserProvider | null;
  signer: ethers.Signer | null;
  chainId: number | null;
  isConnected: boolean;
  isConnecting: boolean;
  isWrongNetwork: boolean;
  isFHENetwork: boolean;   // true only on Fhenix Helium / localcofhe
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
}

// ── Context ───────────────────────────────────────────────────────────────────
const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    provider: null,
    signer: null,
    chainId: null,
    isConnected: false,
    isConnecting: false,
    isWrongNetwork: false,
    isFHENetwork: false,
    error: null,
  });

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: REQUIRED_CHAIN.chainId }],
      });
    } catch (err: any) {
      if (err.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [REQUIRED_CHAIN],
        });
      } else {
        throw err;
      }
    }
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setState((s) => ({ ...s, error: "MetaMask not installed" }));
      return;
    }
    setState((s) => ({ ...s, isConnecting: true, error: null }));
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);

      if (chainId !== REQUIRED_CHAIN_ID) {
        await switchNetwork();
        setState((s) => ({ ...s, isConnecting: false, isWrongNetwork: true, chainId }));
        return;
      }

      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setState({ address, provider, signer, chainId: REQUIRED_CHAIN_ID, isConnected: true, isConnecting: false, isWrongNetwork: false, isFHENetwork: isCoFHENetwork(REQUIRED_CHAIN_ID), error: null });
    } catch (err: any) {
      setState((s) => ({
        ...s,
        isConnecting: false,
        isWrongNetwork: err.code === 4001,
        isFHENetwork: false,
        error: err.code === 4001 ? `Switch to Base Sepolia to continue.` : (err.message ?? "Connection failed"),
      }));
    }
  }, [switchNetwork]);

  const disconnect = useCallback(() => {
    setState({ address: null, provider: null, signer: null, chainId: null, isConnected: false, isConnecting: false, isWrongNetwork: false, isFHENetwork: false, error: null });
  }, []);

  // MetaMask event listeners
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccounts = (accounts: string[]) => (accounts.length === 0 ? disconnect() : connect());
    const onChain = () => connect();
    window.ethereum.on("accountsChanged", onAccounts);
    window.ethereum.on("chainChanged", onChain);
    // Auto-connect if already authorized
    window.ethereum.request({ method: "eth_accounts" }).then((accounts: string[]) => {
      if (accounts.length > 0) connect();
    });
    return () => {
      window.ethereum?.removeListener("accountsChanged", onAccounts);
      window.ethereum?.removeListener("chainChanged", onChain);
    };
  }, [connect, disconnect]);

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect, switchNetwork }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

declare global {
  interface Window { ethereum?: any; }
}
