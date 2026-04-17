import React, { useState } from 'react'
import { TxFeedback } from './TxFeedback'
import { ethers } from 'ethers'
import { useFheEncrypt } from '../hooks/useFheEncrypt'
import { useCreditEngine } from '../hooks/useCreditEngine'

interface CreditDataFormProps {
  signer: ethers.Signer | null
  address: string | null
  provider: ethers.BrowserProvider | null
}

export function CreditDataForm({ signer, address, provider }: CreditDataFormProps) {
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

  const { encryptCreditData, submitCreditData, isEncrypting, error, clearError } = useFheEncrypt(provider, signer)
  const { register, computeScore, loadProfile, profile } = useCreditEngine(signer, address)

  const handleRegisterAndSubmit = async () => {
    if (!profile.isRegistered) {
      setTxState('loading')
      setTxMessage('Registering on-chain...')
      const regResult = await register()
      if (!regResult) {
        setTxState('error')
        setTxMessage('Registration failed')
        return
      }
    }
    await handleSubmit()
  }

  if (!signer || !address) {
    return (
      <div className="empty-state">
        <h3>Connect Wallet</h3>
        <p>Connect your wallet to submit credit data</p>
      </div>
    )
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!signer) return

    setTxState('loading')
    setTxMessage('Processing credit data...')
    clearError()

    try {
      const inputData = {
        income: BigInt(Math.round(Number(form.income || 0) * 1e18)),
        totalDebt: BigInt(Math.round(Number(form.debt || 0) * 1e18)),
        paymentHistory: Number(form.paymentHistory),
        creditUtilization: Number(form.utilization),
        accountAge: Number(form.accountAge),
        numDefaults: Number(form.defaults),
      }

      const creditData = await encryptCreditData(inputData)
      if (!creditData) {
        throw new Error('Processing failed')
      }

      setTxState('encrypted')
      setTxMessage('Submitting to contract...')

      const tx = await submitCreditData(creditData)
      if (!tx) {
        throw new Error('Submission failed')
      }

      setTxMessage(`Credit data submitted. Computing score...`)
      await tx.wait()

      setTxMessage('Computing credit score...')
      await computeScore()

      await loadProfile()
      setTxState('success')
      setTxMessage('Credit data submitted and score computed successfully!')
    } catch (err: any) {
      setTxState('error')
      setTxMessage(err.reason || err.message || 'Submission failed')
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

      {(txState !== 'idle' || error) && (
        <div style={{ marginBottom: 20 }}>
          <TxFeedback
            state={error ? 'error' : txState}
            message={error || txMessage}
            onDismiss={() => { 
              setTxState('idle'); 
              setTxMessage(''); 
              clearError()
            }}
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

          </div>
        </div>

        <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          <button 
            type="button"
            className="btn btn-primary btn-lg"
            disabled={txState === 'loading' || isEncrypting}
            onClick={handleRegisterAndSubmit}
          >
            {txState === 'loading' || isEncrypting ? <span className="loader" /> : 'Submit Credit Data'}
          </button>
          <button type="button" className="btn btn-secondary btn-lg" onClick={() => {
            setForm({
              income: '', debt: '', paymentHistory: '9500', utilization: '3000', accountAge: '365', defaults: '0'
            })
          }}>
            Reset
          </button>
        </div>
      </form>
    </div>
  )
}
