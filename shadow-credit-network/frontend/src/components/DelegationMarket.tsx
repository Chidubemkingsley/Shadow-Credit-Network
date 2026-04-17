import React, { useEffect, useState } from 'react'
import { RiskBadge } from './RiskBadge'
import { TxFeedback } from './TxFeedback'
import { useDelegation } from '../hooks/useDelegation'
import { ethers } from 'ethers'

interface DelegationMarketProps {
  signer: ethers.Signer | null
  address: string | null
}

export function DelegationMarket({ signer, address }: DelegationMarketProps) {
  const { offers, loadOffers, isLoading, error, createOffer, acceptOffer } = useDelegation(signer, address)
  const [filter, setFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('yield')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [acceptingOffer, setAcceptingOffer] = useState<number | null>(null)
  const [acceptAmount, setAcceptAmount] = useState('0.1')
  const [acceptDuration, setAcceptDuration] = useState('30')
  const [newOffer, setNewOffer] = useState({ maxAmount: '1', yieldRate: '500', minScore: '580', maxBonds: '5' })

  useEffect(() => {
    if (signer && address) {
      loadOffers()
    }
  }, [signer, address, loadOffers])

  const handleCreateOffer = async () => {
    const tx = await createOffer(
      ethers.parseEther(newOffer.maxAmount),
      BigInt(newOffer.yieldRate),
      BigInt(newOffer.minScore),
      Number(newOffer.maxBonds)
    )
    if (tx) {
      setShowCreateForm(false)
      setNewOffer({ maxAmount: '1', yieldRate: '500', minScore: '580', maxBonds: '5' })
    }
  }

  const handleAcceptOffer = async (offerId: number) => {
    const tx = await acceptOffer(
      offerId,
      ethers.parseEther(acceptAmount),
      Number(acceptDuration)
    )
    if (tx) {
      setAcceptingOffer(null)
      setAcceptAmount('0.1')
      setAcceptDuration('30')
    }
  }

  const getRiskTier = (minScore: bigint): string => {
    const score = Number(minScore)
    if (score >= 740) return 'Prime'
    if (score >= 670) return 'Near Prime'
    if (score >= 580) return 'Subprime'
    return 'Deep Subprime'
  }

  const filteredOffers = offers
    .filter(o => o.status === 0)
    .filter(o => {
      if (filter === 'all') return true
      const tier = getRiskTier(o.minCreditScore).toLowerCase().replace(' ', '-')
      return tier === filter
    })
    .sort((a, b) => {
      if (sortBy === 'yield') return Number(b.yieldRate) - Number(a.yieldRate)
      if (sortBy === 'available') return Number(b.availableAmount) - Number(a.availableAmount)
      if (sortBy === 'score') return Number(b.minCreditScore) - Number(a.minCreditScore)
      return 0
    })

  const activeBonds = offers.reduce((sum, o) => sum + o.activeBonds, 0)

  if (!signer || !address) {
    return (
      <div className="empty-state">
        <h3>Connect Wallet</h3>
        <p>Connect a wallet to browse delegation offers</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Delegation Market</h1>
        <p className="page-subtitle">Browse and accept credit delegation offers — earn yield or access delegated credit</p>
      </div>

      {/* Market Stats */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--accent-purple)' }}>{offers.filter(o => o.status === 0).length}</div>
          <div className="stat-label">Active Offers</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--accent-green)' }}>
            {Number(offers.reduce((sum, o) => sum + o.availableAmount, 0n) / ethers.parseEther('1')).toFixed(2)}
          </div>
          <div className="stat-label">Available ETH</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>
            {offers.length > 0 ? (Number(offers.reduce((sum, o) => sum + o.yieldRate, 0n)) / Number(offers.length) / 100).toFixed(2) : '0.00'}%
          </div>
          <div className="stat-label">Avg Yield</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>{activeBonds}</div>
          <div className="stat-label">Active Bonds</div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{ marginBottom: 20 }}>
          <TxFeedback state="error" message={error} onDismiss={() => {}} />
        </div>
      )}

      {/* Filters & Actions */}
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
            <button className="btn btn-secondary btn-sm" onClick={() => loadOffers()}>
              Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreateForm(!showCreateForm)}>
              {showCreateForm ? 'Cancel' : '+ Create Offer'}
            </button>
          </div>
        </div>
      </div>

      {/* Create Offer Form */}
      {showCreateForm && (
        <div className="card" style={{ marginBottom: 20, border: '1px solid var(--accent-purple)' }}>
          <div className="card-header">
            <div className="card-title">Create Delegation Offer</div>
          </div>
          <div className="grid-2" style={{ gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Max Amount (ETH)</label>
              <input
                type="number"
                className="form-input"
                value={newOffer.maxAmount}
                onChange={e => setNewOffer(o => ({ ...o, maxAmount: e.target.value }))}
                min="0.01"
                step="0.01"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Yield Rate (bps)</label>
              <input
                type="number"
                className="form-input"
                value={newOffer.yieldRate}
                onChange={e => setNewOffer(o => ({ ...o, yieldRate: e.target.value }))}
                min="1"
                placeholder="500 = 5%"
              />
              <small style={{ color: 'var(--text-muted)' }}>500 bps = 5% APY</small>
            </div>
            <div className="form-group">
              <label className="form-label">Min Credit Score</label>
              <input
                type="number"
                className="form-input"
                value={newOffer.minScore}
                onChange={e => setNewOffer(o => ({ ...o, minScore: e.target.value }))}
                min="300"
                max="850"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Max Bonds</label>
              <input
                type="number"
                className="form-input"
                value={newOffer.maxBonds}
                onChange={e => setNewOffer(o => ({ ...o, maxBonds: e.target.value }))}
                min="1"
              />
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            onClick={handleCreateOffer}
            disabled={isLoading}
          >
            {isLoading ? <span className="loader" /> : 'Create Offer'}
          </button>
        </div>
      )}

      {/* Market Table */}
      <div className="card">
        {isLoading ? (
          <div className="empty-state">
            <span className="loader" />
            <p>Loading offers...</p>
          </div>
        ) : filteredOffers.length === 0 ? (
          <div className="empty-state">
            <h3>No Delegation Offers</h3>
            <p>Be the first to create a delegation offer and earn yield!</p>
          </div>
        ) : (
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
              {filteredOffers.map(offer => {
                const riskTier = getRiskTier(offer.minCreditScore)

                return (
                  <tr key={offer.id}>
                    <td style={{ color: 'var(--text-muted)' }}>{offer.id}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {offer.delegator.slice(0, 6)}...{offer.delegator.slice(-4)}
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>
                        {Number(ethers.formatEther(offer.availableAmount)).toFixed(4)} / {Number(ethers.formatEther(offer.maxAmount)).toFixed(4)} ETH
                      </span>
                    </td>
                    <td>
                      <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>
                        {(Number(offer.yieldRate) / 100).toFixed(2)}%
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>{Number(offer.minCreditScore)}</span>
                    </td>
                    <td><RiskBadge tier={riskTier} size="sm" /></td>
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
                      {address === offer.delegator ? (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Your Offer</span>
                      ) : acceptingOffer === offer.id ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            type="number"
                            className="form-input"
                            style={{ width: 70, padding: '4px 8px', fontSize: 11 }}
                            value={acceptAmount}
                            onChange={e => setAcceptAmount(e.target.value)}
                            placeholder="ETH"
                          />
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleAcceptOffer(offer.id)}
                            disabled={isLoading}
                          >
                            {isLoading ? '...' : '✓'}
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setAcceptingOffer(null)}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setAcceptingOffer(offer.id)}
                          disabled={!signer}
                        >
                          Accept
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {filteredOffers.length === 0 && !isLoading && (
          <div className="empty-state">
            <h3>No Offers Found</h3>
            <p>Try adjusting your filters or check back later</p>
          </div>
        )}
      </div>
    </div>
  )
}
