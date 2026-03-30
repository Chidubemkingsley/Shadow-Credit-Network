/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CREDIT_ENGINE_ADDRESS: string
  readonly VITE_LOAN_POOL_ADDRESS: string
  readonly VITE_DELEGATION_ADDRESS: string
  readonly VITE_REPUTATION_ADDRESS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
