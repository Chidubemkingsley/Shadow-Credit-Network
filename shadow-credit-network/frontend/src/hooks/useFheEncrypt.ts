import { useCallback, useState } from 'react'
import { ethers } from 'ethers'
import { CREDIT_ENGINE_ABI } from '../abis'

const DEFAULT_ADDRESS = '0x749663A4B343846a7C02d14F7d15c72A2643b02B'

export interface CreditDataInput {
  income: bigint
  totalDebt: bigint
  paymentHistory: number
  creditUtilization: number
  accountAge: number
  numDefaults: number
}

export interface PlaintextCreditData {
  income: bigint
  totalDebt: bigint
  paymentHistory: bigint
  creditUtilization: bigint
  accountAge: bigint
  numDefaults: bigint
}

export function useFheEncrypt(provider: any, signer: any) {
  const [isEncrypting, setIsEncrypting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const encryptCreditData = useCallback(async (data: CreditDataInput): Promise<PlaintextCreditData | null> => {
    if (!signer || !provider) {
      setError('No signer or provider available')
      return null
    }

    setIsEncrypting(true)
    setError(null)

    try {
      console.log('Processing credit data (simplified mode)...')
      
      return {
        income: data.income,
        totalDebt: data.totalDebt,
        paymentHistory: BigInt(data.paymentHistory),
        creditUtilization: BigInt(data.creditUtilization),
        accountAge: BigInt(data.accountAge),
        numDefaults: BigInt(data.numDefaults),
      }
    } catch (err: any) {
      console.error('Processing failed:', err)
      setError(err.message || 'Processing failed')
      return null
    } finally {
      setIsEncrypting(false)
    }
  }, [provider, signer])

  const submitCreditData = useCallback(async (creditData: PlaintextCreditData) => {
    if (!signer) {
      setError('No signer available')
      return null
    }

    const contractAddress = (import.meta as any).env?.VITE_CREDIT_ENGINE_ADDRESS || DEFAULT_ADDRESS
    const contract = new ethers.Contract(contractAddress, CREDIT_ENGINE_ABI, signer)

    try {
      console.log('Submitting credit data to contract...', {
        income: creditData.income.toString(),
        totalDebt: creditData.totalDebt.toString(),
        paymentHistory: creditData.paymentHistory.toString(),
        creditUtilization: creditData.creditUtilization.toString(),
        accountAge: creditData.accountAge.toString(),
        numDefaults: creditData.numDefaults.toString(),
      })

      const tx = await contract.submitCreditData(
        creditData.income,
        creditData.totalDebt,
        creditData.paymentHistory,
        creditData.creditUtilization,
        creditData.accountAge,
        creditData.numDefaults
      )
      console.log('Transaction submitted:', tx.hash)
      return tx
    } catch (err: any) {
      console.error('Submit failed:', err)
      setError(err.reason || err.message || 'Submission failed')
      return null
    }
  }, [signer])

  return {
    encryptCreditData,
    submitCreditData,
    isEncrypting,
    error,
    clearError: () => setError(null),
  }
}
