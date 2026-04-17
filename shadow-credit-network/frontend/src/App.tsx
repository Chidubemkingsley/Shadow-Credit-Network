import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useWallet } from './hooks/useWallet'
import { CreditDashboard } from './components/CreditDashboard'
import { CreditDataForm } from './components/CreditDataForm'
import { DelegationMarket } from './components/DelegationMarket'
import { BorrowingPower } from './components/BorrowingPower'
import { ethers } from 'ethers'

function App() {
  const wallet = useWallet()

  return (
    <BrowserRouter>
      <div className="app-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">Shadow Credit</div>

          <nav className="sidebar-nav">
            <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Dashboard
            </NavLink>

            <NavLink to="/submit" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              Submit Data
            </NavLink>

            <NavLink to="/borrow" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v12M6 12h12" />
              </svg>
              Borrow
            </NavLink>

            <NavLink to="/delegation" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              Delegation
            </NavLink>
          </nav>

          {/* Wallet Connection */}
          <div className="sidebar-footer">
            {wallet.isConnected ? (
              <div className="wallet-info">
                <div className="wallet-avatar">
                  {wallet.address?.slice(2, 4).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Connected</div>
                  <div className="wallet-address">
                    {wallet.address?.slice(0, 6)}...{wallet.address?.slice(-4)}
                  </div>
                </div>
                <button
                  onClick={wallet.disconnect}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: 18, padding: 4,
                  }}
                  title="Disconnect"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={wallet.connect}
                disabled={wallet.isConnecting}
              >
                {wallet.isConnecting ? <span className="loader" /> : 'Connect Wallet'}
              </button>
            )}
            {wallet.error && (
              <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 8 }}>{wallet.error}</div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="main-content">
          <Routes>
            <Route path="/" element={<CreditDashboard signer={wallet.signer} address={wallet.address} />} />
            <Route path="/submit" element={<CreditDataForm signer={wallet.signer} address={wallet.address} provider={wallet.provider} />} />
            <Route path="/borrow" element={<BorrowingPower signer={wallet.signer} address={wallet.address} provider={wallet.provider} />} />
            <Route path="/delegation" element={<DelegationMarket signer={wallet.signer} address={wallet.address} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
