/// <reference types="vite/client" />

declare module 'snarkjs' {
  export interface Groth16Proof {
    pi_a: string[]
    pi_b: string[][]
    pi_c: string[]
    protocol: string
    curve: string
  }

  export interface PublicSignals {
    [key: string]: string
  }

  export interface Groth16Prover {
    fullProve(input: any, wasmPath: string, zkeyPath: string): Promise<{
      proof: Groth16Proof
      publicSignals: string[]
    }>
    verify(vKey: any, publicSignals: string[], proof: Groth16Proof): Promise<boolean>
  }

  export const groth16: Groth16Prover
}

interface ImportMetaEnv {
  readonly VITE_CREDIT_ENGINE_ADDRESS: string
  readonly VITE_LOAN_POOL_ADDRESS: string
  readonly VITE_DELEGATION_ADDRESS: string
  readonly VITE_REPUTATION_ADDRESS: string
  readonly VITE_ZK_BRIDGE_ADDRESS: string
  readonly VITE_GROTH16_VERIFIER_ADDRESS: string
  readonly VITE_CHAIN_ID: string
  readonly VITE_RPC_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
