import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { ethers } from "ethers";

// ── Network config ────────────────────────────────────────────────────────────
const REQUIRED_CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID ?? "421614");

// CoFHE-enabled networks: Fhenix Helium (8008135), localcofhe (412346),
// and Arbitrum Sepolia (421614) — CoFHE now live on Arbitrum.
const COFHE_CHAIN_IDS = new Set([8008135, 412346, 421614]);
export const isCoFHENetwork = (chainId: number | null): boolean =>
  chainId !== null && COFHE_CHAIN_IDS.has(chainId);

function getChainConfig(chainId: number): { chainName: string; rpcUrl: string; blockExplorer: string } {
  if (chainId === 421614) return {
    chainName: "Arbitrum Sepolia",
    rpcUrl: import.meta.env.VITE_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
    blockExplorer: import.meta.env.VITE_BLOCK_EXPLORER ?? "https://sepolia.arbiscan.io",
  };
  if (chainId === 8008135) return {
    chainName: "Fhenix Helium",
    rpcUrl: import.meta.env.VITE_RPC_URL ?? "https://api.helium.fhenix.zone",
    blockExplorer: import.meta.env.VITE_BLOCK_EXPLORER ?? "",
  };
  if (chainId === 84532) return {
    chainName: "Base Sepolia",
    rpcUrl: import.meta.env.VITE_RPC_URL ?? "https://sepolia.base.org",
    blockExplorer: import.meta.env.VITE_BLOCK_EXPLORER ?? "https://sepolia.basescan.org",
  };
  // Default: Arbitrum Sepolia
  return {
    chainName: "Arbitrum Sepolia",
    rpcUrl: import.meta.env.VITE_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
    blockExplorer: import.meta.env.VITE_BLOCK_EXPLORER ?? "https://sepolia.arbiscan.io",
  };
}

const chainConfig = getChainConfig(REQUIRED_CHAIN_ID);

const REQUIRED_CHAIN = {
  chainId: `0x${REQUIRED_CHAIN_ID.toString(16)}`,
  chainName: chainConfig.chainName,
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: [chainConfig.rpcUrl],
  blockExplorerUrls: [chainConfig.blockExplorer],
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
  isFHENetwork: boolean;   // true on Arbitrum Sepolia / Fhenix Helium / localcofhe
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
      // Arbitrum Sepolia: add 50% buffer to gas to avoid
      // "max fee per gas less than block base fee" RPC errors
      // Arbitrum doesn't support eth_maxPriorityFeePerGas (EIP-1559),
      // so we use legacy gasPrice for Arbitrum Sepolia.
      const ARBITRUM_SEPOLIA = 421614;
      const _origSendTx = signer.sendTransaction.bind(signer);
      signer.sendTransaction = async (tx: ethers.TransactionRequest) => {
        if (chainId === ARBITRUM_SEPOLIA) {
          const gasPrice = BigInt(await provider.send("eth_gasPrice", []));
          tx.gasPrice = (gasPrice * 15n) / 10n;
        } else {
          try {
            const feeData = await provider.getFeeData();
            if (feeData.maxFeePerGas)
              tx.maxFeePerGas = (feeData.maxFeePerGas * 15n) / 10n;
            if (feeData.maxPriorityFeePerGas)
              tx.maxPriorityFeePerGas = (feeData.maxPriorityFeePerGas * 15n) / 10n;
          } catch {
            const gasPrice = BigInt(await provider.send("eth_gasPrice", []));
            tx.gasPrice = (gasPrice * 15n) / 10n;
          }
        }
        return _origSendTx(tx);
      };
      const address = await signer.getAddress();
      setState({ address, provider, signer, chainId: REQUIRED_CHAIN_ID, isConnected: true, isConnecting: false, isWrongNetwork: false, isFHENetwork: isCoFHENetwork(REQUIRED_CHAIN_ID), error: null });
    } catch (err: any) {
      setState((s) => ({
        ...s,
        isConnecting: false,
        isWrongNetwork: err.code === 4001,
        isFHENetwork: false,
        error: err.code === 4001 ? `Switch to ${chainConfig.chainName} to continue.` : (err.message ?? "Connection failed"),
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
