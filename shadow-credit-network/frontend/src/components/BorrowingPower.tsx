import React from 'react'
import { ScoreGauge } from './ScoreGauge'
import { RiskBadge } from './RiskBadge'
import { ethers } from 'ethers'

interface BorrowingPowerProps {
  signer: ethers.Signer | null
  address: string | null
}

export function BorrowingPower({ signer, address }: BorrowingPowerProps) {
  // Mock data for demonstration
  const mockData = {
    score: 701,
    riskTier: 'Near Prime',
    riskFactor: 30, // 30% of income
    income: 5.0, // ETH
    totalDebt: 1.5,
    borrowingPower: 0.0, // income * factor / 100 - debt
    poolLiquidity: 125.5,
  }

  mockData.borrowingPower = Math.max(0, (mockData.income * mockData.riskFactor / 100) - mockData.totalDebt)

  if (!signer || !address) {
    return (
      <div className="empty-state">
        <h3>Connect Wallet</h3>
        <p>Connect to view your borrowing power</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Borrowing Power</h1>
        <p className="page-subtitle">Your undercollateralized borrowing capacity based on encrypted credit score</p>
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        {/* Main Borrowing Power Card */}
        <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: 0, right: 0, width: 200, height: 200,
            background: 'radial-gradient(circle at top right, rgba(108, 92, 231, 0.1), transparent)',
          }} />
          <div className="card-header">
            <div className="card-title">Available to Borrow</div>
            <RiskBadge tier={mockData.riskTier} />
          </div>
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{
              fontSize: 56,
              fontWeight: 800,
              letterSpacing: -2,
              background: 'var(--gradient-purple)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              {mockData.borrowingPower.toFixed(2)} ETH
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
              Based on {mockData.riskFactor}% risk factor for {mockData.riskTier} tier
            </div>
          </div>
          <div className="grid-3" style={{ gap: 12, marginTop: 16 }}>
            <div className="stat-box" style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
              <div className="stat-label">Income</div>
              <div className="stat-value" style={{ fontSize: 18, color: 'var(--accent-green)' }}>{mockData.income} ETH</div>
            </div>
            <div className="stat-box" style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
              <div className="stat-label">Debt</div>
              <div className="stat-value" style={{ fontSize: 18, color: 'var(--accent-red)' }}>{mockData.totalDebt} ETH</div>
            </div>
            <div className="stat-box" style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
              <div className="stat-label">Risk Factor</div>
              <div className="stat-value" style={{ fontSize: 18, color: 'var(--accent-blue)' }}>{mockData.riskFactor}%</div>
            </div>
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 24 }} disabled={!signer}>
            Request Loan
          </button>
        </div>

        {/* Score Component */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Credit Score</div>
            <span className="status-dot active" />
          </div>
          <ScoreGauge score={mockData.score} />

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Risk Tier Breakdown</div>
            {[
              { label: 'Prime', min: 740, color: 'var(--accent-green)', factor: '50%' },
              { label: 'Near Prime', min: 670, color: 'var(--accent-blue)', factor: '30%' },
              { label: 'Subprime', min: 580, color: 'var(--accent-yellow)', factor: '15%' },
              { label: 'Deep Subprime', min: 0, color: 'var(--accent-red)', factor: '5%' },
            ].map(tier => (
              <div key={tier.label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                background: tier.label === mockData.riskTier ? 'rgba(108, 92, 231, 0.1)' : 'transparent',
                marginBottom: 4,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: tier.color }} />
                  <span style={{ fontSize: 13, fontWeight: tier.label === mockData.riskTier ? 600 : 400 }}>
                    {tier.label} ({tier.min > 0 ? `${tier.min}+` : '<580'})
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{tier.factor} of income</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pool Info */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Pool Liquidity</div>
          <div className="card-subtitle">Total ETH available for lending</div>
        </div>
        <div className="grid-3">
          <div className="stat-box">
            <div className="stat-value" style={{ color: 'var(--accent-green)' }}>{mockData.poolLiquidity} ETH</div>
            <div className="stat-label">Available</div>
          </div>
          <div className="stat-box">
            <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>12</div>
            <div className="stat-label">Active Loans</div>
          </div>
          <div className="stat-box">
            <div className="stat-value" style={{ color: 'var(--accent-purple)' }}>2.3%</div>
            <div className="stat-label">Default Rate</div>
          </div>
        </div>
      </div>
    </div>
  )
}
