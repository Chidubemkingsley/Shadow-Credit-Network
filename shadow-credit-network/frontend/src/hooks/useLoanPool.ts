import { useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { LOAN_POOL_ABI } from '../abis'

const DEFAULT_LOAN_POOL_ADDRESS = '0x0A2AB73CB8311aFD261Ab92137ff70E9Ca268d69'

export interface LoanPoolState {
  totalLiquidity: bigint
  availableLiquidity: bigint
  activeLoans: number
  defaultRate: number
}

export interface UserLoans {
  loanIds: number[]
  loans: Array<{
    borrower: string
    principal: bigint
    interestRate: bigint
    repaidAmount: bigint
    totalOwed: bigint
    status: number
    dueDate: bigint
    creditVerified: boolean
    creditPassed: boolean
  }>
}

export interface LenderDeposit {
  address: string
  amount: bigint
  depositedAt: number
}

export interface UserLoans {
  loanIds: number[]
  loans: Array<{
    borrower: string
    principal: bigint
    interestRate: bigint
    repaidAmount: bigint
    totalOwed: bigint
    status: number
    dueDate: bigint
    creditVerified: boolean
    creditPassed: boolean
  }>
}

export interface LenderDeposit {
  address: string
  amount: bigint
  depositedAt: number
}

export function useLoanPool(signer: ethers.Signer | null, address: string | null) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [poolState, setPoolState] = useState<LoanPoolState>({
    totalLiquidity: 0n,
    availableLiquidity: 0n,
    activeLoans: 0,
    defaultRate: 0,
  })

  const getContract = useCallback(() => {
    if (!signer) return null
    const contractAddress = (import.meta as any).env?.VITE_LOAN_POOL_ADDRESS || DEFAULT_LOAN_POOL_ADDRESS
    return new ethers.Contract(contractAddress, LOAN_POOL_ABI, signer)
  }, [signer])

  const loadPoolState = useCallback(async () => {
    const contract = getContract()
    if (!contract) return

    setIsLoading(true)
    try {
      const totalLiquidity = await contract.totalPoolLiquidity()
      const availableLiquidity = await contract.getAvailableLiquidity()
      const loanCount = await contract.loanCount()

      let defaultedCount = 0
      for (let i = 0; i < Number(loanCount); i++) {
        try {
          const status = await contract.getLoanStatus(i)
          if (Number(status) === 3) { // Defaulted status
            defaultedCount++
          }
        } catch {
          // Skip if error
        }
      }

      const defaultRate = Number(loanCount) > 0 ? (defaultedCount / Number(loanCount)) * 100 : 0

      setPoolState({
        totalLiquidity,
        availableLiquidity,
        activeLoans: Number(loanCount),
        defaultRate,
      })
    } catch (err: any) {
      console.error('Failed to load pool state:', err)
      setError(err.reason || err.message)
    } finally {
      setIsLoading(false)
    }
  }, [getContract])

  const fundPool = useCallback(async (amount: bigint) => {
    const contract = getContract()
    if (!contract) return null

    setIsLoading(true)
    setError(null)
    try {
      const tx = await contract.fundPool({ value: amount })
      await tx.wait()
      await loadPoolState()
      return tx
    } catch (err: any) {
      setError(err.reason || err.message || 'Transaction failed')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [getContract, loadPoolState])

  const requestLoan = useCallback(async (
    principal: bigint,
    duration: number,
    riskPool: number
  ) => {
    const contract = getContract()
    if (!contract) return null

    setIsLoading(true)
    setError(null)
    try {
      console.log('Requesting loan:', { principal: principal.toString(), duration, riskPool })

      const tx = await contract.requestLoan(principal, duration, riskPool)
      console.log('Transaction sent:', tx.hash)
      await tx.wait()
      console.log('Transaction confirmed')
      return tx
    } catch (err: any) {
      console.error('requestLoan error:', err)
      setError(err.reason || err.message || 'Transaction failed')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [getContract])

  const repayLoan = useCallback(async (loanId: number, amount: bigint) => {
    const contract = getContract()
    if (!contract) return null

    setIsLoading(true)
    setError(null)
    try {
      const tx = await contract.repayLoan(loanId, { value: amount })
      await tx.wait()
      return tx
    } catch (err: any) {
      setError(err.reason || err.message || 'Transaction failed')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [getContract])

  const getUserLoans = useCallback(async (): Promise<UserLoans | null> => {
    const contract = getContract()
    if (!contract || !address) return null

    try {
      const loanIds: number[] = await contract.getBorrowerLoans(address)
      const loans = await Promise.all(
        loanIds.map(async (id: number) => {
          const loan = await contract.getLoan(id)
          return {
            borrower: loan[0],
            principal: loan[1],
            interestRate: loan[2],
            repaidAmount: loan[3],
            totalOwed: loan[4],
            status: Number(loan[5]),
            dueDate: loan[6],
            creditVerified: loan[7],
            creditPassed: loan[8],
          }
        })
      )
      return { loanIds, loans }
    } catch (err: any) {
      console.error('Failed to get user loans:', err)
      return null
    }
  }, [getContract, address])

  const loadLenderDeposits = useCallback(async (): Promise<LenderDeposit[]> => {
    const contract = getContract()
    if (!contract) return []

    try {
      const lenderCount = await contract.getLenderCount()
      const deposits: LenderDeposit[] = []

      for (let i = 0; i < Number(lenderCount); i++) {
        const lenderAddress = await contract.getLenderAtIndex(i)
        const [amount, depositedAt] = await contract.getLenderDeposit(lenderAddress)
        if (amount > 0n) {
          deposits.push({
            address: lenderAddress,
            amount,
            depositedAt: Number(depositedAt),
          })
        }
      }

      return deposits.sort((a, b) => Number(b.amount - a.amount))
    } catch (err: any) {
      console.error('Failed to load lender deposits:', err)
      return []
    }
  }, [getContract])

  return {
    poolState,
    loadPoolState,
    fundPool,
    requestLoan,
    repayLoan,
    getUserLoans,
    loadLenderDeposits,
    isLoading,
    error,
    clearError: () => setError(null),
  }
}