import React, { useState } from 'react'
import { RiskBadge } from './RiskBadge'
import { ethers } from 'ethers'

interface DelegationMarketProps {
  signer: ethers.Signer | null
  address: string | null
}

// Mock market data for the trading terminal
const MOCK_OFFERS = [
  { id: 0, delegator: '0x742d...8f2a', maxAmount: '10.0', yieldRate: '5.0%', minScore: 670, riskTier: 'Near Prime', activeBonds: 2, maxBonds: 5, available: '7.5' },
  { id: 1, delegator: '0x8ba1...3c9e', maxAmount: '25.0', yieldRate: '8.0%', minScore: 580, riskTier: 'Subprime', activeBonds: 4, maxBonds: 5, available: '3.2' },
  { id: 2, delegator: '0x1f98...d4b2', maxAmount: '50.0', yieldRate: '3.0%', minScore: 740, riskTier: 'Prime', activeBonds: 1, maxBonds: 10, available: '45.0' },
  { id: 3, delegator: '0xab38...7e1f', maxAmount: '5.0', yieldRate: '12.0%', minScore: 580, riskTier: 'Deep Subprime', activeBonds: 0, maxBonds: 3, available: '5.0' },
]

export function DelegationMarket({ signer, address }: DelegationMarketProps) {
  const [filter, setFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('yield')

  const filteredOffers = MOCK_OFFERS.filter(o => {
    if (filter === 'all') return true
    return o.riskTier.toLowerCase().replace(' ', '-') === filter
  }).sort((a, b) => {
    if (sortBy === 'yield') return parseFloat(b.yieldRate) - parseFloat(a.yieldRate)
    if (sortBy === 'available') return parseFloat(b.available) - parseFloat(a.available)
    if (sortBy === 'score') return b.minScore - a.minScore
    return 0
  })

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Delegation Market</h1>
        <p className="page-subtitle">Browse and accept credit delegation offers — earn yield or access delegated credit</p>
      </div>

      {/* Market Stats */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--accent-purple)' }}>4</div>
          <div className="stat-label">Active Offers</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--accent-green)' }}>90.0</div>
          <div className="stat-label">Total ETH Available</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>7.0%</div>
          <div className="stat-label">Avg Yield Rate</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>7</div>
          <div className="stat-label">Active Bonds</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Filter:</span>
          {['all', 'prime', 'near-prime', 'subprime', 'deep-subprime'].map(f => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Sort:</span>
            <select
              className="form-input"
              style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              <option value="yield">Yield Rate</option>
              <option value="available">Available</option>
              <option value="score">Min Score</option>
            </select>
          </div>
        </div>
      </div>

      {/* Market Table */}
      <div className="card">
        <table className="terminal-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Delegator</th>
              <th>Available / Max</th>
              <th>Yield Rate</th>
              <th>Min Score</th>
              <th>Risk Tier</th>
              <th>Bonds</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredOffers.map(offer => (
              <tr key={offer.id}>
                <td style={{ color: 'var(--text-muted)' }}>{offer.id}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{offer.delegator}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{offer.available} ETH</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>of {offer.maxAmount} ETH</div>
                </td>
                <td>
                  <span style={{ color: 'var(--accent-green)', fontWeight: 700, fontSize: 16 }}>
                    {offer.yieldRate}
                  </span>
                </td>
                <td>{offer.minScore}</td>
                <td><RiskBadge tier={offer.riskTier} size="sm" /></td>
                <td>
                  <span style={{ fontSize: 12 }}>
                    {offer.activeBonds}/{offer.maxBonds}
                  </span>
                  <div className="progress-bar" style={{ width: 60 }}>
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${(offer.activeBonds / offer.maxBonds) * 100}%`,
                        background: offer.activeBonds / offer.maxBonds > 0.8 ? 'var(--accent-red)' : 'var(--accent-purple)',
                      }}
                    />
                  </div>
                </td>
                <td>
                  <button className="btn btn-primary btn-sm" disabled={!signer}>
                    Accept
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredOffers.length === 0 && (
          <div className="empty-state">
            <h3>No Offers Found</h3>
            <p>Try adjusting your filters</p>
          </div>
        )}
      </div>
    </div>
  )
}
