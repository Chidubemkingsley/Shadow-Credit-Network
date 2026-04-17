import React, { useEffect, useState } from 'react'
import { ScoreGauge } from './ScoreGauge'
import { RiskBadge } from './RiskBadge'
import { TxFeedback } from './TxFeedback'
import { useLoanPool } from '../hooks/useLoanPool'
import { useCreditEngine } from '../hooks/useCreditEngine'
import { ethers } from 'ethers'

interface BorrowingPowerProps {
  signer: ethers.Signer | null
  address: string | null
  provider?: ethers.BrowserProvider | null
}

export function BorrowingPower({ signer, address, provider }: BorrowingPowerProps) {
  const { poolState, loadPoolState, fundPool, requestLoan, repayLoan, getUserLoans, isLoading, error, loadLenderDeposits } = useLoanPool(signer, address)
  const { profile, loadProfile } = useCreditEngine(signer, address)
  const [showFundModal, setShowFundModal] = useState(false)
  const [showLoanModal, setShowLoanModal] = useState(false)
  const [fundAmount, setFundAmount] = useState('1')
  const [loanAmount, setLoanAmount] = useState('0.5')
  const [loanDuration, setLoanDuration] = useState('30')
  const [txMessage, setTxMessage] = useState('')
  const [lenderDeposits, setLenderDeposits] = useState<Array<{address: string, amount: bigint, depositedAt: number}>>([])
  const [userLoans, setUserLoans] = useState<any[]>([])
  const [repayLoanId, setRepayLoanId] = useState<number | null>(null)
  const [repayAmount, setRepayAmount] = useState('')

  useEffect(() => {
    if (signer && address) {
      loadPoolState()
      loadProfile()
      loadLenderDeposits().then(setLenderDeposits)
      loadUserLoansData()
    }
  }, [signer, address, loadPoolState, loadProfile, loadLenderDeposits])

  const loadUserLoansData = async () => {
    const loans = await getUserLoans()
    if (loans) {
      setUserLoans(loans.loans)
    }
  }

  const handleRepayLoan = async () => {
    if (repayLoanId === null) return
    const amount = ethers.parseEther(repayAmount)
    const tx = await repayLoan(repayLoanId, amount)
    if (tx) {
      setRepayLoanId(null)
      setRepayAmount('')
      loadUserLoansData()
      loadPoolState()
    }
  }

  const getStatusLabel = (status: number) => {
    switch (status) {
      case 0: return 'Pending'
      case 1: return 'Active'
      case 2: return 'Repaid'
      case 3: return 'Defaulted'
      default: return 'Unknown'
    }
  }

  const getStatusColor = (status: number) => {
    switch (status) {
      case 0: return 'var(--text-muted)'
      case 1: return 'var(--accent-green)'
      case 2: return 'var(--accent-blue)'
      case 3: return 'var(--accent-red)'
      default: return 'var(--text-muted)'
    }
  }

  const poolLiquidityEth = Number(ethers.formatEther(poolState.availableLiquidity || 0n))
  const borrowingPower = poolLiquidityEth > 0 ? Math.min(poolLiquidityEth, 10) : 0

  const getRiskTierFromScore = (score: number | null) => {
    if (score === null) return 'Unknown'
    if (score >= 740) return 'Prime'
    if (score >= 670) return 'Near Prime'
    if (score >= 580) return 'Subprime'
    return 'Deep Subprime'
  }

  const getRiskFactor = (tier: string) => {
    switch (tier) {
      case 'Prime': return 50
      case 'Near Prime': return 30
      case 'Subprime': return 15
      case 'Deep Subprime': return 5
      default: return 0
    }
  }

  const riskTier = getRiskTierFromScore(profile.score)
  const riskFactor = getRiskFactor(riskTier)

  const handleFundPool = async () => {
    setTxMessage('Funding pool...')
    const amount = ethers.parseEther(fundAmount)
    const tx = await fundPool(amount)
    if (tx) {
      setTxMessage('Pool funded successfully!')
      setShowFundModal(false)
      setFundAmount('1')
    }
  }

  const handleRequestLoan = async () => {
    setTxMessage('Submitting loan request...')
    
    try {
      const amount = ethers.parseEther(loanAmount)
      const durationDays = parseInt(loanDuration)
      console.log('Requesting loan:', { amount: ethers.formatEther(amount), duration: durationDays })
      
      const tx = await requestLoan(amount, durationDays, 0)
      
      if (!tx) {
        throw new Error('Transaction failed - check console for details')
      }
      
      console.log('Loan requested:', tx.hash)
      setTxMessage('Loan requested successfully! ETH sent to your wallet.')
      setShowLoanModal(false)
      setLoanAmount('0.5')
      setLoanDuration('30')
      loadUserLoansData()
      loadPoolState()
    } catch (err: any) {
      console.error('Loan request error:', err)
      setTxMessage(err.message || 'Loan request failed')
    }
  }

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
            <RiskBadge tier={riskTier} />
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
              {borrowingPower.toFixed(2)} ETH
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
              Based on {riskFactor}% risk factor for {riskTier} tier
            </div>
          </div>
          <div className="grid-3" style={{ gap: 12, marginTop: 16 }}>
            <div className="stat-box" style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
              <div className="stat-label">Credit Score</div>
              <div className="stat-value" style={{ fontSize: 18, color: 'var(--accent-green)' }}>
                {profile.score ?? 'N/A'}
              </div>
            </div>
            <div className="stat-box" style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
              <div className="stat-label">Status</div>
              <div className="stat-value" style={{ fontSize: 14, color: 'var(--accent-blue)' }}>
                {profile.hasScore ? 'Active' : 'Pending'}
              </div>
            </div>
            <div className="stat-box" style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
              <div className="stat-label">Risk Factor</div>
              <div className="stat-value" style={{ fontSize: 18, color: 'var(--accent-purple)' }}>{riskFactor}%</div>
            </div>
          </div>
          <button 
            className="btn btn-primary btn-lg" 
            style={{ width: '100%', marginTop: 24 }} 
            disabled={!signer || !profile.hasScore || poolLiquidityEth === 0}
            onClick={() => setShowLoanModal(true)}
          >
            {!profile.hasScore ? 'Submit Credit Data First' : poolLiquidityEth === 0 ? 'Pool Empty - Fund First' : 'Request Loan'}
          </button>
        </div>

        {/* Score Component */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Credit Score</div>
            <span className={`status-dot ${profile.hasScore ? 'active' : 'pending'}`} />
          </div>
          <ScoreGauge score={profile.score ?? 0} />

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
                background: tier.label === riskTier ? 'rgba(108, 92, 231, 0.1)' : 'transparent',
                marginBottom: 4,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: tier.color }} />
                  <span style={{ fontSize: 13, fontWeight: tier.label === riskTier ? 600 : 400 }}>
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
          <button className="btn btn-secondary btn-sm" onClick={() => { loadPoolState(); loadUserLoansData(); }} style={{marginLeft: 8}}>
            ↻
          </button>
        </div>
        <div className="grid-3">
          <div className="stat-box">
            <div className="stat-value" style={{ color: 'var(--accent-green)' }}>{Number(ethers.formatEther(poolState.availableLiquidity || 0n)).toFixed(4)} ETH</div>
            <div className="stat-label">Available</div>
          </div>
          <div className="stat-box">
            <div className="stat-value" style={{ color: 'var(--accent-blue)' }}>{poolState.activeLoans}</div>
            <div className="stat-label">Active Loans</div>
          </div>
          <div className="stat-box">
            <div className="stat-value" style={{ color: 'var(--accent-purple)' }}>
              {typeof poolState.defaultRate === 'number' ? poolState.defaultRate.toFixed(1) : '0.0'}%
            </div>
            <div className="stat-label">Default Rate</div>
          </div>
        </div>
        <button 
          className="btn btn-secondary" 
          style={{ marginTop: 16, width: '100%' }}
          onClick={() => setShowFundModal(true)}
        >
          + Fund Pool (Earn Interest)
        </button>
      </div>

      {/* Transaction Feedback */}
      {(txMessage || error) && (
        <div style={{ marginTop: 16 }}>
          <TxFeedback 
            state={error ? 'error' : 'success'} 
            message={error || txMessage} 
            onDismiss={() => { setTxMessage(''); }} 
          />
        </div>
      )}

      {/* My Loans */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title">My Loans</div>
          <div className="card-subtitle">Your borrowed positions</div>
        </div>
        {userLoans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
            No active loans. Request a loan above to get started.
          </div>
        ) : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {userLoans.map((loan, index) => {
              const remaining = loan.totalOwed - loan.repaidAmount
              const isOverdue = loan.status === 1 && loan.dueDate < Math.floor(Date.now() / 1000)
              return (
                <div key={index} style={{
                  padding: 16,
                  borderBottom: index < userLoans.length - 1 ? '1px solid var(--border)' : 'none',
                  background: loan.status === 1 ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
                  borderRadius: loan.status === 1 ? 8 : 0,
                  marginBottom: loan.status === 1 ? 8 : 0,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>
                          {Number(ethers.formatEther(loan.principal)).toFixed(4)} ETH
                        </span>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: getStatusColor(loan.status),
                          textTransform: 'uppercase'
                        }}>
                          {getStatusLabel(loan.status)}
                        </span>
                        {isOverdue && (
                          <span style={{ fontSize: 10, color: 'var(--accent-red)', fontWeight: 700 }}>
                            OVERDUE
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Interest: {(Number(loan.interestRate) / 100).toFixed(2)}% • Due: {new Date(Number(loan.dueDate) * 1000).toLocaleDateString()}
                      </div>
                    </div>
                    {loan.status === 1 && (
                      repayLoanId === index ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            type="number"
                            className="form-input"
                            style={{ width: 80, padding: '4px 8px', fontSize: 11 }}
                            value={repayAmount}
                            onChange={e => setRepayAmount(e.target.value)}
                            placeholder="ETH"
                          />
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={handleRepayLoan}
                            disabled={isLoading}
                          >
                            {isLoading ? '...' : '✓'}
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setRepayLoanId(null); setRepayAmount('') }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            setRepayLoanId(index)
                            setRepayAmount(Number(ethers.formatEther(remaining)).toFixed(4))
                          }}
                        >
                          Repay
                        </button>
                      )
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                    <div style={{ color: 'var(--text-muted)' }}>
                      Total Owed: <span style={{ color: 'var(--text-primary)' }}>{Number(ethers.formatEther(loan.totalOwed)).toFixed(4)} ETH</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      Repaid: <span style={{ color: 'var(--accent-blue)' }}>{Number(ethers.formatEther(loan.repaidAmount)).toFixed(4)} ETH</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      Remaining: <span style={{ color: loan.status === 1 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{Number(ethers.formatEther(remaining)).toFixed(4)} ETH</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      Loan ID: <span style={{ fontFamily: 'monospace' }}>#{index}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pool Deposits */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title">Pool Deposits</div>
          <div className="card-subtitle">Who has funded the lending pool</div>
        </div>
        {lenderDeposits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
            No deposits yet. Be the first to fund the pool!
          </div>
        ) : (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {lenderDeposits.map((deposit, index) => (
              <div key={deposit.address} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: index < lenderDeposits.length - 1 ? '1px solid var(--border)' : 'none'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'var(--accent-purple)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700
                  }}>
                    {index + 1}
                  </div>
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {deposit.address.toLowerCase() === address?.toLowerCase() 
                        ? 'You' 
                        : `${deposit.address.slice(0, 6)}...${deposit.address.slice(-4)}`}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {new Date(deposit.depositedAt * 1000).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: 'var(--accent-green)' }}>
                    {Number(ethers.formatEther(deposit.amount)).toFixed(3)} ETH
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {((Number(deposit.amount) / Number(ethers.formatEther(poolState.totalLiquidity))) * 100).toFixed(1)}% of pool
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fund Pool Modal */}
      {showFundModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card" style={{ width: 400, maxWidth: '90%' }}>
            <div className="card-header">
              <div className="card-title">Fund Pool</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowFundModal(false)}>×</button>
            </div>
            <div className="form-group">
              <label className="form-label">Amount (ETH)</label>
              <input
                type="number"
                className="form-input"
                value={fundAmount}
                onChange={e => setFundAmount(e.target.value)}
                min="0.01"
                step="0.01"
              />
              <small style={{ color: 'var(--accent-purple)' }}>Minimum: 0.01 ETH</small>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Earn interest when borrowers repay loans. Your funds are at risk.
            </div>
            <button 
              className="btn btn-primary" 
              style={{ width: '100%' }}
              onClick={handleFundPool}
              disabled={isLoading || parseFloat(fundAmount) <= 0}
            >
              {isLoading ? <span className="loader" /> : 'Fund Pool'}
            </button>
          </div>
        </div>
      )}

      {/* Request Loan Modal */}
      {showLoanModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card" style={{ width: 400, maxWidth: '90%' }}>
            <div className="card-header">
              <div className="card-title">Request Loan</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowLoanModal(false)}>×</button>
            </div>
            
            {txMessage && (
              <div style={{ marginBottom: 16 }}>
                <TxFeedback 
                  state={txMessage.includes('failed') || txMessage.includes('error') || txMessage.includes('Error') ? 'error' : 'success'} 
                  message={txMessage} 
                  onDismiss={() => setTxMessage('')} 
                />
              </div>
            )}
            
            <div className="form-group">
              <label className="form-label">Amount (ETH)</label>
              <input
                type="number"
                className="form-input"
                value={loanAmount}
                onChange={e => setLoanAmount(e.target.value)}
                min="0.01"
                max={poolLiquidityEth.toString()}
                step="0.01"
                disabled={isLoading}
              />
              <small style={{ color: 'var(--text-muted)' }}>Max: {poolLiquidityEth.toFixed(2)} ETH</small>
            </div>
            <div className="form-group">
              <label className="form-label">Duration (days)</label>
              <input
                type="number"
                className="form-input"
                value={loanDuration}
                onChange={e => setLoanDuration(e.target.value)}
                min="7"
                max="365"
                disabled={isLoading}
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Loan amount sent as transaction value.
            </div>
            <button 
              className="btn btn-primary" 
              style={{ width: '100%' }}
              onClick={handleRequestLoan}
              disabled={isLoading || parseFloat(loanAmount) <= 0}
            >
              {isLoading ? <span className="loader" /> : 'Request Loan'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
