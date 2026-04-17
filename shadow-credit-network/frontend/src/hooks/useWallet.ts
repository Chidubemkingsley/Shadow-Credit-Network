import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'

// ── Target network config ─────────────────────────────────────────────────────
// Base Sepolia Testnet (supports FHE via CoFHE)
const REQUIRED_CHAIN_ID = 84532 // Base Sepolia

const REQUIRED_CHAIN = {
  chainId:          '0x14a34',                          // 84532 in hex
  chainName:        'Base Sepolia',
  nativeCurrency:   { name: 'Base Sepolia ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls:          ['https://sepolia.base.org'],
  blockExplorerUrls:['https://sepolia.basescan.org'],
} as const

// ─────────────────────────────────────────────────────────────────────────────

export interface WalletState {
  address:      string | null
  provider:     ethers.BrowserProvider | null
  signer:       ethers.Signer | null
  chainId:      number | null
  isConnected:  boolean
  isConnecting: boolean
  isWrongNetwork: boolean   // ← NEW: true when on wrong chain
  error:        string | null
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address:        null,
    provider:       null,
    signer:         null,
    chainId:        null,
    isConnected:    false,
    isConnecting:   false,
    isWrongNetwork: false,
    error:          null,
  })

  // ── Switch or add the required network ───────────────────────────────────
  const switchToRequiredNetwork = useCallback(async () => {
    try {
      // First try switching — works if the network is already in MetaMask
      await window.ethereum!.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: REQUIRED_CHAIN.chainId }],
      })
    } catch (switchError: any) {
      // Error 4902 = chain not added to MetaMask yet → add it
      if (switchError.code === 4902) {
        await window.ethereum!.request({
          method: 'wallet_addEthereumChain',
          params: [REQUIRED_CHAIN],
        })
      } else {
        throw switchError
      }
    }
  }, [])

  // ── Core connect logic ────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (typeof window.ethereum === 'undefined') {
      setState(s => ({ ...s, error: 'MetaMask not installed' }))
      return
    }

    setState(s => ({ ...s, isConnecting: true, error: null }))

    try {
      const provider = new ethers.BrowserProvider(window.ethereum)

      // Request accounts first (shows MetaMask popup if not authorized)
      await provider.send('eth_requestAccounts', [])

      // Check current chain BEFORE getting signer
      const network = await provider.getNetwork()
      const currentChainId = Number(network.chainId)

      if (currentChainId !== REQUIRED_CHAIN_ID) {
        // Prompt MetaMask to switch — this resolves after the user confirms
        await switchToRequiredNetwork()
        // After the switch, chainChanged fires and triggers a re-connect.
        // Set isWrongNetwork temporarily so the UI can show a switching state.
        setState(s => ({
          ...s,
          isConnecting:   false,
          isWrongNetwork: true,
          chainId:        currentChainId,
          error:          null,
        }))
        return  // ← exit here; chainChanged event will call connect() again
      }

      // We're on the right network — build the full state
      const signer  = await provider.getSigner()
      const address = await signer.getAddress()

      setState({
        address,
        provider,
        signer,
        chainId:        REQUIRED_CHAIN_ID,
        isConnected:    true,
        isConnecting:   false,
        isWrongNetwork: false,
        error:          null,
      })

    } catch (err: any) {
      // User rejected the network switch → stay on wrong network state
      const isRejection = err.code === 4001

      setState(s => ({
        ...s,
        isConnecting:   false,
        isWrongNetwork: isRejection ? true : s.isWrongNetwork,
        error: isRejection
          ? `Please switch to ${REQUIRED_CHAIN.chainName} to continue.`
          : (err.message || 'Failed to connect'),
      }))
    }
  }, [switchToRequiredNetwork])

  // ── Disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    setState({
      address:        null,
      provider:       null,
      signer:         null,
      chainId:        null,
      isConnected:    false,
      isConnecting:   false,
      isWrongNetwork: false,
      error:          null,
    })
  }, [])

  // ── MetaMask event listeners ──────────────────────────────────────────────
  useEffect(() => {
    if (typeof window.ethereum === 'undefined') return

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect()
      } else {
        connect()
      }
    }

    // chainChanged always fires as a hex string — just re-run connect()
    // which will check the new chainId and switch if needed
    const handleChainChanged = () => {
      connect()
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged',    handleChainChanged)

    // Auto-connect if wallet already authorized (no popup)
    window.ethereum
      .request({ method: 'eth_accounts' })
      .then((accounts: string[]) => {
        if (accounts.length > 0) connect()
      })

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum?.removeListener('chainChanged',    handleChainChanged)
    }
  }, [connect, disconnect])

  return { ...state, connect, disconnect, switchToRequiredNetwork }
}

declare global {
  interface Window {
    ethereum?: any
  }
}