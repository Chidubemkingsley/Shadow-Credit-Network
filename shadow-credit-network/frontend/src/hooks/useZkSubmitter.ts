/**
 * useZkSubmitter - Hook for submitting credit data with ZK proofs
 * 
 * DEPRECATED: This hook is not used with the simplified credit engine.
 * Kept for reference only.
 */

import { useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { useFheEncrypt, type CreditDataInput } from './useFheEncrypt'

export interface ZkProof {
    a: [string, string]
    b: [[string, string], [string, string]]
    c: [string, string]
}

export interface ZkSubmissionInput {
    creditData: CreditDataInput
    proof: ZkProof
    pubSignals: string[]
    proofNonce: bigint
}

export function useZkSubmitter(provider: ethers.BrowserProvider | null, signer: ethers.Signer | null) {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { encryptCreditData, isEncrypting } = useFheEncrypt(provider, signer)

    const submitWithZk = useCallback(async (
        input: ZkSubmissionInput,
        zkBridgeAddress?: string
    ) => {
        setError('ZK submission not available with simplified credit engine')
        return null
    }, [])

    const generateProof = useCallback(async (
        creditData: CreditDataInput,
        wasmPath: string,
        zkeyPath: string
    ): Promise<ZkProof | null> => {
        setError('ZK proofs not available with simplified credit engine')
        return null
    }, [])

    const verifyProof = useCallback(async (
        proof: ZkProof,
        pubSignals: string[],
        zkBridgeAddress?: string
    ): Promise<boolean> => {
        return false
    }, [])

    return {
        submitWithZk,
        generateProof,
        verifyProof,
        isSubmitting,
        isEncrypting,
        error,
        clearError: () => setError(null),
    }
}
