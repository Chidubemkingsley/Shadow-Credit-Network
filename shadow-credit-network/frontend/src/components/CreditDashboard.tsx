import React, { useEffect } from 'react'
import { ScoreGauge } from './ScoreGauge'
import { RiskBadge } from './RiskBadge'
import { TxFeedback } from './TxFeedback'
import { useCreditEngine, type CreditProfile } from '../hooks/useCreditEngine'
import { ethers } from 'ethers'

interface CreditDashboardProps {
  signer: ethers.Signer | null
  address: string | null
}

export function CreditDashboard({ signer, address }: CreditDashboardProps) {
  const {
    profile,
    txState,
    txMessage,
    loadProfile,
    register,
    computeScore,
    decryptScore,
    resetTxState,
  } = useCreditEngine(signer, address)

  useEffect(() => {
    if (signer && address) loadProfile()
  }, [signer, address, loadProfile])

  if (!signer || !address) {
    return (
      <div className="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        <h3>Connect Your Wallet</h3>
        <p>Connect a wallet to view your encrypted credit profile</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Credit Dashboard</h1>
        <p className="page-subtitle">Your privacy-preserving credit profile — all data encrypted on-chain</p>
      </div>

      {txState !== 'idle' && (
        <div style={{ marginBottom: 20 }}>
          <TxFeedback state={txState} message={txMessage} onDismiss={resetTxState} />
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 24 }}>
        {/* Score Gauge */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Encrypted Credit Score</div>
              <div className="card-subtitle">Powered by FHE — computed on-chain</div>
            </div>
            {profile.riskTier !== 'Unknown' && <RiskBadge tier={profile.riskTier} />}
          </div>
          <ScoreGauge score={profile.score} />
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
            {!profile.isRegistered && (
              <button className="btn btn-primary" onClick={register} disabled={txState === 'loading'}>
                Register On-Chain
              </button>
            )}
            {profile.isRegistered && !profile.hasScore && (
              <button className="btn btn-primary" onClick={computeScore} disabled={txState === 'loading'}>
                Compute Score
              </button>
            )}
            {profile.hasScore && !profile.isDecrypted && (
              <button className="btn btn-secondary" onClick={decryptScore} disabled={txState === 'loading'}>
                Decrypt Score
              </button>
            )}
            {profile.hasScore && profile.isDecrypted && (
              <button className="btn btn-secondary" onClick={computeScore} disabled={txState === 'loading'}>
                Recompute
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Profile Status</div>
              <div className="card-subtitle">On-chain state indicators</div>
            </div>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <div className="stat-box" style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
              <div className="stat-label">Registration</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 4 }}>
                <span className={`status-dot ${profile.isRegistered ? 'active' : 'pending'}`} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{profile.isRegistered ? 'Active' : 'Not Registered'}</span>
              </div>
            </div>
            <div className="stat-box" style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
              <div className="stat-label">Score Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 4 }}>
                <span className={`status-dot ${profile.hasScore ? (profile.isDecrypted ? 'active' : 'encrypted') : 'pending'}`} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {profile.hasScore ? (profile.isDecrypted ? 'Decrypted' : 'Encrypted') : 'Not Computed'}
                </span>
              </div>
            </div>
            <div className="stat-box" style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
              <div className="stat-label">Risk Tier</div>
              <div style={{ marginTop: 8 }}>
                <RiskBadge tier={profile.riskTier} size="sm" />
              </div>
            </div>
            <div className="stat-box" style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
              <div className="stat-label">Wallet</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)', marginTop: 8 }}>
                {address.slice(0, 6)}...{address.slice(-4)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid-3">
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
          <div className="card-title">FHE-Powered</div>
          <div className="card-subtitle" style={{ marginTop: 4 }}>
            Your financial data is encrypted on-chain using Fully Homomorphic Encryption. No one can see your raw data.
          </div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚡</div>
          <div className="card-title">Private Scoring</div>
          <div className="card-subtitle" style={{ marginTop: 4 }}>
            Credit scores are computed on encrypted data. Only you can decrypt your score.
          </div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🛡️</div>
          <div className="card-title">No KYC Required</div>
          <div className="card-subtitle" style={{ marginTop: 4 }}>
            Prove creditworthiness without revealing personal information. Privacy by design.
          </div>
        </div>
      </div>
    </div>
  )
}
