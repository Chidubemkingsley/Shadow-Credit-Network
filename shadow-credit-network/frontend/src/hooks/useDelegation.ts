import { useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { DELEGATION_ABI } from '../abis'

const DEFAULT_DELEGATION_ADDRESS = '0xA97c943555E92b7E8472118A3b058e72edcDC694'

export interface DelegationOffer {
  id: number
  delegator: string
  maxAmount: bigint
  availableAmount: bigint
  yieldRate: bigint
  minCreditScore: bigint
  status: number
  activeBonds: number
  maxBonds: number
}

export function useDelegation(signer: ethers.Signer | null, address: string | null) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offers, setOffers] = useState<DelegationOffer[]>([])
  const [totalDelegated, setTotalDelegated] = useState(0n)

  const getContract = useCallback(() => {
    if (!signer) return null
    const contractAddress = (import.meta as any).env?.VITE_DELEGATION_ADDRESS || DEFAULT_DELEGATION_ADDRESS
    return new ethers.Contract(contractAddress, DELEGATION_ABI, signer)
  }, [signer])

  const loadOffers = useCallback(async () => {
    const contract = getContract()
    if (!contract) {
      setError('No signer available')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      console.log('Loading offers from:', await contract.getAddress())
      const offerCount = await contract.offerCount()
      console.log('Offer count:', Number(offerCount))

      if (Number(offerCount) === 0) {
        setOffers([])
        setIsLoading(false)
        return
      }

      const loadedOffers: DelegationOffer[] = []

      for (let i = 0; i < Number(offerCount); i++) {
        try {
          const offer = await contract.getOffer(i)
          const status = await contract.getOfferStatus(i)
          console.log(`Offer ${i}:`, offer)

          loadedOffers.push({
            id: i,
            delegator: offer[0],
            maxAmount: offer[1],
            availableAmount: offer[2],
            yieldRate: offer[3],
            minCreditScore: offer[4],
            status: Number(status),
            activeBonds: Number(offer[5]),
            maxBonds: Number(offer[6]),
          })
        } catch (offerErr: any) {
          console.error(`Failed to load offer ${i}:`, offerErr)
        }
      }

      setOffers(loadedOffers)
    } catch (err: any) {
      console.error('Failed to load offers:', err)
      setError(err.message || 'Failed to load offers')
    } finally {
      setIsLoading(false)
    }
  }, [getContract])

  const createOffer = useCallback(async (
    maxAmount: bigint,
    yieldRate: bigint,
    minCreditScore: bigint,
    maxBonds: number
  ) => {
    const contract = getContract()
    if (!contract) return null

    setIsLoading(true)
    setError(null)
    try {
      const tx = await contract.createOffer(maxAmount, yieldRate, minCreditScore, maxBonds)
      await tx.wait()
      await loadOffers()
      return tx
    } catch (err: any) {
      setError(err.message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [getContract, loadOffers])

  const acceptOffer = useCallback(async (
    offerId: number,
    amount: bigint,
    duration: number
  ) => {
    const contract = getContract()
    if (!contract) return null

    setIsLoading(true)
    setError(null)
    try {
      const tx = await contract.acceptOffer(offerId, amount, duration)
      await tx.wait()
      await loadOffers()
      return tx
    } catch (err: any) {
      setError(err.message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [getContract, loadOffers])

  const cancelOffer = useCallback(async (offerId: number) => {
    const contract = getContract()
    if (!contract) return null

    setIsLoading(true)
    setError(null)
    try {
      const tx = await contract.cancelOffer(offerId)
      await tx.wait()
      await loadOffers()
      return tx
    } catch (err: any) {
      setError(err.message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [getContract, loadOffers])

  const getUserOffers = useCallback(async (): Promise<number[] | null> => {
    const contract = getContract()
    if (!contract || !address) return null

    try {
      return await contract.getDelegatorOffers(address)
    } catch (err: any) {
      console.error('Failed to get user offers:', err)
      return null
    }
  }, [getContract, address])

  const getUserBonds = useCallback(async (): Promise<number[] | null> => {
    const contract = getContract()
    if (!contract || !address) return null

    try {
      return await contract.getBorrowerBonds(address)
    } catch (err: any) {
      console.error('Failed to get user bonds:', err)
      return null
    }
  }, [getContract, address])

  return {
    offers,
    totalDelegated,
    loadOffers,
    createOffer,
    acceptOffer,
    cancelOffer,
    getUserOffers,
    getUserBonds,
    isLoading,
    error,
    clearError: () => setError(null),
  }
}
