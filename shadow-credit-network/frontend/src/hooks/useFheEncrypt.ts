/**
 * useFheEncrypt - FHE encryption using @cofhe/sdk
 * 
 * Handles encrypted credit data submission to FHE-enabled contracts
 * Uses CoFHE for client-side encryption
 */

import { useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { CREDIT_ENGINE_ABI } from '../abis'

import { createCofheConfig, createCofheClient } from '@cofhe/sdk/web'
import { Ethers6Adapter } from '@cofhe/sdk/adapters'
import { Encryptable } from '@cofhe/sdk'
import { baseSepolia, arbSepolia } from '@cofhe/sdk/chains'

const DEFAULT_CREDIT_ENGINE = '0x0000000000000000000000000000000000000001'

export interface CreditDataInput {
  income: bigint
  totalDebt: bigint
  paymentHistory: number
  creditUtilization: number
  accountAge: number
  numDefaults: number
}

export interface EncryptedCreditData {
  income: any
  totalDebt: any
  paymentHistory: any
  creditUtilization: any
  accountAge: any
  numDefaults: any
}

let cofheClient: any = null

async function getCofheClient(provider: ethers.BrowserProvider, signer: ethers.Signer) {
  if (cofheClient) return cofheClient

  const config = createCofheConfig({
    supportedChains: [baseSepolia, arbSepolia],
  })

  const client = createCofheClient(config)
  const { publicClient, walletClient } = await Ethers6Adapter(provider, signer)
  await client.connect(publicClient, walletClient)

  cofheClient = client
  return cofheClient
}

export function useFheEncrypt(provider: ethers.BrowserProvider | null, signer: ethers.Signer | null) {
  const [isEncrypting, setIsEncrypting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const encryptCreditData = useCallback(async (
    data: CreditDataInput
  ): Promise<EncryptedCreditData | null> => {
    if (!provider || !signer) {
      setError('No provider or signer')
      return null
    }

    setIsEncrypting(true)
    setError(null)

    try {
      const client = await getCofheClient(provider, signer)
      const address = await signer.getAddress()

      console.log('Encrypting credit data for:', address)

      const [encIncome] = await client.encryptInputs([
        Encryptable.uint64(data.income)
      ]).execute()

      const [encTotalDebt] = await client.encryptInputs([
        Encryptable.uint64(data.totalDebt)
      ]).execute()

      const [encPaymentHistory] = await client.encryptInputs([
        Encryptable.uint32(BigInt(data.paymentHistory))
      ]).execute()

      const [encCreditUtilization] = await client.encryptInputs([
        Encryptable.uint32(BigInt(data.creditUtilization))
      ]).execute()

      const [encAccountAge] = await client.encryptInputs([
        Encryptable.uint32(BigInt(data.accountAge))
      ]).execute()

      const [encNumDefaults] = await client.encryptInputs([
        Encryptable.uint32(BigInt(data.numDefaults))
      ]).execute()

      console.log('FHE encryption complete')

      return {
        income: encIncome,
        totalDebt: encTotalDebt,
        paymentHistory: encPaymentHistory,
        creditUtilization: encCreditUtilization,
        accountAge: encAccountAge,
        numDefaults: encNumDefaults,
      }
    } catch (err: any) {
      console.error('FHE encryption failed:', err)
      setError(err.message || 'Encryption failed')
      return null
    } finally {
      setIsEncrypting(false)
    }
  }, [provider, signer])

  const submitCreditData = useCallback(async (
    encryptedData: EncryptedCreditData
  ): Promise<ethers.ContractTransactionResponse | null> => {
    if (!signer) {
      setError('No signer')
      return null
    }

    const contractAddress = (import.meta as any).env?.VITE_CREDIT_ENGINE_ADDRESS || DEFAULT_CREDIT_ENGINE
    const contract = new ethers.Contract(contractAddress, CREDIT_ENGINE_ABI, signer)

    try {
      console.log('Submitting encrypted data to FHE contract...')
      
      const tx = await contract.submitCreditData(
        encryptedData.income,
        encryptedData.totalDebt,
        encryptedData.paymentHistory,
        encryptedData.creditUtilization,
        encryptedData.accountAge,
        encryptedData.numDefaults
      )

      console.log('Transaction sent:', tx.hash)
      return tx
    } catch (err: any) {
      console.error('Submission failed:', err)
      setError(err.reason || err.message || 'Submission failed')
      return null
    }
  }, [signer])

  const computeScore = useCallback(async (): Promise<ethers.ContractTransactionResponse | null> => {
    if (!signer) return null

    const contractAddress = (import.meta as any).env?.VITE_CREDIT_ENGINE_ADDRESS || DEFAULT_CREDIT_ENGINE
    const contract = new ethers.Contract(contractAddress, CREDIT_ENGINE_ABI, signer)

    try {
      console.log('Computing FHE credit score...')
      const tx = await contract.computeCreditScore()
      console.log('Score computation:', tx.hash)
      return tx
    } catch (err: any) {
      console.error('Score computation failed:', err)
      setError(err.message || 'Score computation failed')
      return null
    }
  }, [signer])

  const getScore = useCallback(async (address: string): Promise<number | null> => {
    if (!provider) return null

    const contractAddress = (import.meta as any).env?.VITE_CREDIT_ENGINE_ADDRESS || DEFAULT_CREDIT_ENGINE
    const contract = new ethers.Contract(contractAddress, CREDIT_ENGINE_ABI, provider)

    try {
      const score = await contract.getCreditScore(address)
      return Number(score)
    } catch (err) {
      console.error('Failed to get score:', err)
      return null
    }
  }, [provider])

  return {
    encryptCreditData,
    submitCreditData,
    computeScore,
    getScore,
    isEncrypting,
    error,
    clearError: () => setError(null),
  }
}