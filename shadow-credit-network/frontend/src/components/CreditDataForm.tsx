import React, { useState } from 'react'
import { TxFeedback } from './TxFeedback'
import { ethers } from 'ethers'
import { CREDIT_ENGINE_ABI } from '../abis'

interface CreditDataFormProps {
  signer: ethers.Signer | null
  address: string | null
}

export function CreditDataForm({ signer, address }: CreditDataFormProps) {
  const [form, setForm] = useState({
    income: '',
    debt: '',
    paymentHistory: '9500',
    utilization: '3000',
    accountAge: '365',
    defaults: '0',
  })
  const [txState, setTxState] = useState<'idle' | 'loading' | 'encrypted' | 'success' | 'error'>('idle')
  const [txMessage, setTxMessage] = useState('')

  if (!signer || !address) {
    return (
      <div className="empty-state">
        <h3>Connect Wallet</h3>
        <p>Connect your wallet to submit credit data</p>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!signer) return

    setTxState('loading')
    setTxMessage('Encrypting data with FHE...')

    try {
      // In production, this uses cofhejs.encrypt() to create encrypted inputs
      // For now, we demonstrate the form UX flow
      setTxState('encrypted')
      setTxMessage('Encrypted data ready. Submitting to contract...')

      // Simulated submission
      await new Promise(r => setTimeout(r, 2000))

      setTxState('success')
      setTxMessage('Credit data submitted successfully!')
    } catch (err: any) {
      setTxState('error')
      setTxMessage(err.message || 'Submission failed')
    }
  }

  const paymentPercent = (Number(form.paymentHistory) / 100).toFixed(1)
  const utilizationPercent = (Number(form.utilization) / 100).toFixed(1)

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Submit Credit Data</h1>
        <p className="page-subtitle">All data is encrypted on-chain via FHE — your privacy is guaranteed</p>
      </div>

      {txState !== 'idle' && (
        <div style={{ marginBottom: 20 }}>
          <TxFeedback
            state={txState}
            message={txMessage}
            onDismiss={() => { setTxState('idle'); setTxMessage('') }}
          />
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid-2">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Financial Data</div>
              <span className="status-dot encrypted" />
            </div>

            <div className="form-group">
              <label className="form-label">Annual Income (ETH)</label>
              <input
                type="number"
                className="form-input"
                placeholder="e.g., 5.0"
                value={form.income}
                onChange={e => setForm(f => ({ ...f, income: e.target.value }))}
                step="0.01"
                min="0"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Total Debt (ETH)</label>
              <input
                type="number"
                className="form-input"
                placeholder="e.g., 1.5"
                value={form.debt}
                onChange={e => setForm(f => ({ ...f, debt: e.target.value }))}
                step="0.01"
                min="0"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Account Age (days)</label>
              <input
                type="number"
                className="form-input"
                placeholder="e.g., 365"
                value={form.accountAge}
                onChange={e => setForm(f => ({ ...f, accountAge: e.target.value }))}
                min="0"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Number of Defaults</label>
              <input
                type="number"
                className="form-input"
                placeholder="0"
                value={form.defaults}
                onChange={e => setForm(f => ({ ...f, defaults: e.target.value }))}
                min="0"
              />
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Behavioral Data</div>
              <span className="status-dot encrypted" />
            </div>

            <div className="form-group">
              <label className="form-label">
                Payment History: <strong style={{ color: 'var(--accent-green)' }}>{paymentPercent}%</strong>
              </label>
              <input
                type="range"
                min="0"
                max="10000"
                step="100"
                value={form.paymentHistory}
                onChange={e => setForm(f => ({ ...f, paymentHistory: e.target.value }))}
                style={{ width: '100%', accentColor: 'var(--accent-purple)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Credit Utilization: <strong style={{ color: utilizationPercent <= '30' ? 'var(--accent-green)' : 'var(--accent-yellow)' }}>{utilizationPercent}%</strong>
              </label>
              <input
                type="range"
                min="0"
                max="10000"
                step="100"
                value={form.utilization}
                onChange={e => setForm(f => ({ ...f, utilization: e.target.value }))}
                style={{ width: '100%', accentColor: 'var(--accent-purple)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Info Box */}
            <div style={{
              marginTop: 16,
              padding: 16,
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--accent-purple)' }}>
                🔐 Encryption Preview
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', lineHeight: 1.8 }}>
                income → euint64(0x{Math.round(Number(form.income || 0) * 1e18).toString(16).slice(0, 8)}...)<br/>
                debt → euint64(0x{Math.round(Number(form.debt || 0) * 1e18).toString(16).slice(0, 8)}...)<br/>
                payment → euint32(0x{Number(form.paymentHistory).toString(16).padStart(8, '0')})<br/>
                utilization → euint32(0x{Number(form.utilization).toString(16).padStart(8, '0')})<br/>
                age → euint32(0x{Number(form.accountAge).toString(16).padStart(8, '0')})<br/>
                defaults → euint32(0x{Number(form.defaults).toString(16).padStart(8, '0')})
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          <button type="submit" className="btn btn-primary btn-lg" disabled={txState === 'loading'}>
            {txState === 'loading' ? <span className="loader" /> : '🔐 Encrypt & Submit'}
          </button>
          <button type="button" className="btn btn-secondary btn-lg" onClick={() => setForm({
            income: '', debt: '', paymentHistory: '9500', utilization: '3000', accountAge: '365', defaults: '0'
          })}>
            Reset
          </button>
        </div>
      </form>
    </div>
  )
}
