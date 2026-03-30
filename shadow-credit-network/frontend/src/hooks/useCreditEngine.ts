import { useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { CREDIT_ENGINE_ABI } from '../abis'

// Replace with deployed contract address
const DEFAULT_ADDRESS = ''

export type TxState = 'idle' | 'loading' | 'encrypted' | 'success' | 'error'

export interface CreditProfile {
  isRegistered: boolean
  hasScore: boolean
  score: number | null
  isDecrypted: boolean
  riskTier: string
}

export function useCreditEngine(signer: ethers.Signer | null, address: string | null) {
  const [txState, setTxState] = useState<TxState>('idle')
  const [txMessage, setTxMessage] = useState('')
  const [profile, setProfile] = useState<CreditProfile>({
    isRegistered: false,
    hasScore: false,
    score: null,
    isDecrypted: false,
    riskTier: 'Unknown',
  })

  const getContract = useCallback(() => {
    if (!signer) return null
    const contractAddress = (import.meta as any).env?.VITE_CREDIT_ENGINE_ADDRESS || DEFAULT_ADDRESS
    return new ethers.Contract(contractAddress, CREDIT_ENGINE_ABI, signer)
  }, [signer])

  const loadProfile = useCallback(async () => {
    if (!signer || !address) return
    try {
      const contract = getContract()
      if (!contract) return

      const isRegistered = await contract.isRegistered(address)
      const hasScore = isRegistered ? await contract.hasComputedScore(address) : false

      let score = null
      let isDecrypted = false
      let riskTier = 'Unknown'

      if (hasScore) {
        try {
          const [scoreValue, decrypted] = await contract.getDecryptedScoreSafe()
          if (decrypted) {
            score = Number(scoreValue)
            isDecrypted = true
            riskTier = score >= 740 ? 'Prime' : score >= 670 ? 'Near Prime' : score >= 580 ? 'Subprime' : 'Deep Subprime'
          }
        } catch {
          // Score not yet decrypted
        }
      }

      setProfile({ isRegistered, hasScore, score, isDecrypted, riskTier })
    } catch (err) {
      console.error('Failed to load profile:', err)
    }
  }, [signer, address, getContract])

  const register = useCallback(async () => {
    const contract = getContract()
    if (!contract) return

    setTxState('loading')
    setTxMessage('Registering on-chain...')

    try {
      const tx = await contract.register()
      setTxState('encrypted')
      setTxMessage('Transaction submitted, waiting for confirmation...')
      await tx.wait()
      setTxState('success')
      setTxMessage('Registration complete!')
      await loadProfile()
    } catch (err: any) {
      setTxState('error')
      setTxMessage(err.message || 'Registration failed')
    }
  }, [getContract, loadProfile])

  const computeScore = useCallback(async () => {
    const contract = getContract()
    if (!contract) return

    setTxState('loading')
    setTxMessage('Computing encrypted credit score...')

    try {
      const tx = await contract.computeCreditScore()
      setTxState('encrypted')
      setTxMessage('FHE computation in progress...')
      await tx.wait()
      setTxState('success')
      setTxMessage('Credit score computed!')
      await loadProfile()
    } catch (err: any) {
      setTxState('error')
      setTxMessage(err.message || 'Score computation failed')
    }
  }, [getContract, loadProfile])

  const decryptScore = useCallback(async () => {
    const contract = getContract()
    if (!contract) return

    setTxState('loading')
    setTxMessage('Requesting decryption...')

    try {
      const tx = await contract.requestScoreDecryption()
      setTxState('encrypted')
      setTxMessage('Decrypting score...')
      await tx.wait()
      setTxState('success')
      setTxMessage('Score decrypted!')
      await loadProfile()
    } catch (err: any) {
      setTxState('error')
      setTxMessage(err.message || 'Decryption failed')
    }
  }, [getContract, loadProfile])

  return {
    profile,
    txState,
    txMessage,
    loadProfile,
    register,
    computeScore,
    decryptScore,
    resetTxState: () => { setTxState('idle'); setTxMessage('') },
  }
}
