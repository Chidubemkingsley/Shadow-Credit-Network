import React from 'react'
import type { TxState } from '../hooks/useCreditEngine'

interface TxFeedbackProps {
  state: TxState
  message: string
  onDismiss?: () => void
}

export function TxFeedback({ state, message, onDismiss }: TxFeedbackProps) {
  if (state === 'idle') return null

  const icons: Record<string, string> = {
    loading: '⟳',
    encrypted: '🔐',
    success: '✓',
    error: '✗',
  }

  return (
    <div className={`tx-state ${state}`} onClick={onDismiss} style={{ cursor: onDismiss ? 'pointer' : 'default' }}>
      {state === 'loading' && <span className="loader" />}
      {state !== 'loading' && <span>{icons[state]}</span>}
      <span>{message}</span>
    </div>
  )
}
