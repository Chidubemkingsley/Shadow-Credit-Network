# Shadow Credit Network

> **Privacy-preserving undercollateralized lending on Base Sepolia.**
> Your credit score is computed on encrypted data. No plaintext ever touches the chain.

---

## Live System — Verify in 3 Minutes

**Network:** Base Sepolia (Chain ID: 84532)

| Contract | Address | Explorer |
|---|---|---|
| `EncryptedCreditEngineV3` | `0x5A03628A15674c425606e0D4710D66EBa8da09E6` | [View](https://sepolia.basescan.org/address/0x5A03628A15674c425606e0D4710D66EBa8da09E6) |
| `PrivateLoanPoolV3` | `0x9227C5cC17A2C92fb44DB633C3327CF5E1246913` | [View](https://sepolia.basescan.org/address/0x9227C5cC17A2C92fb44DB633C3327CF5E1246913) |
| `CreditDelegationV2` | `0xB60cA6232CD26CC74C5605C35E9EbecF4C882348` | [View](https://sepolia.basescan.org/address/0xB60cA6232CD26CC74C5605C35E9EbecF4C882348) |
| `ReputationRegistry` | `0xeecAb683D93a483669D797E4B7a06e8c286A25dC` | [View](https://sepolia.basescan.org/address/0xeecAb683D93a483669D797E4B7a06e8c286A25dC) |
| `CreditDataWithZK` | `0xA464874091e2F16838746f41F2c5781dc01AEb51` | [View](https://sepolia.basescan.org/address/0xA464874091e2F16838746f41F2c5781dc01AEb51) |
| `SimpleCreditEngine` *(Wave 1)* | `0x749663A4B343846a7C02d14F7d15c72A2643b02B` | [View](https://sepolia.basescan.org/address/0x749663A4B343846a7C02d14F7d15c72A2643b02B) |
| `PrivateLoanPool` *(Wave 1)* | `0x0A2AB73CB8311aFD261Ab92137ff70E9Ca268d69` | [View](https://sepolia.basescan.org/address/0x0A2AB73CB8311aFD261Ab92137ff70E9Ca268d69) |
| `CreditDelegation` *(Wave 1)* | `0xA97c943555E92b7E8472118A3b058e72edcDC694` | [View](https://sepolia.basescan.org/address/0xA97c943555E92b7E8472118A3b058e72edcDC694) |

**Deployer:** `0x90356CF97B3BF1749A604d3F89b3DF3602A459E3`
**Deployed:** Wave 3 contracts live on Base Sepolia — 2026-05-03

```bash
# Verify any contract in 30 seconds
cast call 0x5A03628A15674c425606e0D4710D66EBa8da09E6 \
  "getUserCount()(uint256)" \
  --rpc-url https://sepolia.base.org
```

---

## The Problem

DeFi lending today requires overcollateralization — you must lock up more than you borrow. This excludes the majority of real-world borrowers who have creditworthiness but not idle capital. Traditional credit scoring solves this, but it requires revealing sensitive financial data.

**Shadow Credit Network solves both problems simultaneously:**
- Undercollateralized lending based on on-chain credit scores
- All financial data encrypted using Fully Homomorphic Encryption (FHE)
- No plaintext income, debt, or payment history ever stored on-chain
- Credit scores computed entirely in the encrypted domain

---

## What Shadow Credit Solves

| Problem | Traditional DeFi | Shadow Credit |
|---|---|---|
| Overcollateralization | Requires 150%+ collateral | Credit-based, no collateral needed |
| Financial privacy | All data public on-chain | All data FHE-encrypted |
| Credit identity | No portable credit history | On-chain encrypted score + history |
| Loan approval | Instant but blind | FHE ebool-gated, cryptographically verified |
| Yield for lenders | Fixed pool rates | Proportional yield from interest |
| Reputation | No protocol memory | 6-factor encrypted reputation registry |
| Score freshness | Stale data accepted | 180-day expiry enforced on-chain |
| Delegation | Yield accumulates, never paid | Yield transfers to delegator on repayment |

---

## Why Shadow Credit Wins

| Dimension | Competitors | Shadow Credit |
|---|---|---|
| **Privacy model** | Plaintext on-chain or off-chain trust | FHE — computed on ciphertext, no trusted party |
| **Loan approval** | Owner bool or oracle | `ebool` from `FHE.gte(score, threshold)` — cryptographic proof |
| **Score computation** | Off-chain, centralized | Fully on-chain in encrypted domain |
| **Data submission** | Plaintext or ZK range proofs only | ZK range proofs + FHE encryption (hybrid) |
| **Reputation** | None | 6-factor weighted, FHE-encrypted, auto-updated |
| **Lender yield** | Pool APY, no per-lender tracking | Proportional distribution per repayment |
| **Score history** | None | Ciphertext handles stored on-chain, provable trajectory |
| **Composability** | Siloed | `grantScoreAccess()` — any authorized protocol can read encrypted score |
| **Delegation** | Not available | Full lifecycle: create offer → accept bond → repay → yield paid |

---

## Who It's For

**Borrowers** who have on-chain financial history but no idle collateral. Submit encrypted income, debt, and payment data. Get a credit score (300–850) computed in the FHE domain. Borrow from risk-tiered pools without revealing a single number.

**Lenders** who want yield on idle ETH. Fund the pool, earn proportional interest as borrowers repay. Claim accrued yield at any time. No lock-up period.

**Delegators** who want to monetize their credit reputation. Create delegation offers with a yield rate and minimum score requirement. Borrowers accept bonds; yield transfers directly to the delegator on each repayment.

**Protocol integrators** who need a privacy-preserving credit primitive. Call `grantScoreAccess(yourContract)` to read a user's encrypted score handle. Build lending, insurance, or identity products on top.

---

## Security — Core Innovation

The four invariants that make Shadow Credit trustworthy:

### 1. ETH never moves without a verified FHE result

```solidity
// PrivateLoanPoolV3.resolveLoanApproval()
(bool ready, bool approved) = creditEngine.resolveApprovalCheck(loan.approvalCheckId);
if (!ready) return;  // FHE decryption not complete — retry later
if (approved) {
    _activateAndDisburse(_loanId);  // only path to ETH transfer
}
// No owner override. No plaintext bool bypass.
```

The `approvalCheckId` maps to an `ebool` created by `FHE.gte(encCreditScore, threshold)`. The ebool is decrypted asynchronously by the FHE network. `_disburseLoan()` is only reachable through `_activateAndDisburse()`, which is only reachable when `approved == true`.

### 2. No plaintext financial data on-chain

```solidity
// EncryptedCreditEngineV3.submitCreditData()
// Each InEuint* carries a ZK proof of knowledge from the CoFHE SDK.
// FHE.asEuint*(InEuint*) verifies the proof and registers the ciphertext.
encIncome[msg.sender] = FHE.asEuint64(_income);
// income is now a ciphertext handle — unreadable without the user's key
```

### 3. Score freshness enforced on-chain

```solidity
// EncryptedCreditEngineV3.requestApprovalCheck()
if (block.timestamp - scoreComputedAt[user] > scoreValidityPeriod) {
    revert StaleScore();  // 180-day default, owner-configurable
}
```

Stale scores cannot be used to obtain loans. Borrowers must resubmit data and recompute.

### 4. Reputation updates are automatic and tamper-resistant

```solidity
// PrivateLoanPoolV3.repayLoan() — on full repayment
_notifyReputation(msg.sender, true);
// Calls ReputationRegistry.notifyActivity() via authorized integration contract
// Updates ProtocolInteraction factor — no user action required
```

---

## Full Protocol Flow

```
User
 │
 ├─ register()                    → creates on-chain identity
 │
 ├─ submitCreditData(             → 6 FHE ciphertexts from CoFHE SDK
 │    InEuint64 income,           → ZK proof verifies range validity
 │    InEuint64 totalDebt,        → FHE.asEuint64() registers with ACL
 │    InEuint32 paymentHistory,
 │    InEuint32 creditUtilization,
 │    InEuint32 accountAge,
 │    InEuint32 numDefaults
 │  )
 │
 ├─ computeCreditScore()          → all arithmetic in FHE domain
 │    score = clamp(              → no plaintext intermediate values
 │      300 + paymentScore        → result: euint32 ciphertext handle
 │          + utilScore
 │          + ageScore
 │          - penalty,
 │      300, 850
 │    )
 │    → appends ctHash to scoreHistory[]
 │    → calls ReputationRegistry.notifyActivity()
 │
 ├─ requestScoreDecryption()      → FHE.decrypt(encCreditScore)
 │    → async: FHE network decrypts          [Fhenix Helium / localcofhe only]
 │    → poll getDecryptedScore() until isDecrypted == true
 │
 ├─ requestLoan(principal,        → PrivateLoanPoolV3
 │    duration, riskPool)         → calls requestApprovalCheck()
 │                                → FHE.gte(score, threshold) → ebool
 │                                → FHE.decrypt(ebool) async
 │                                [Fhenix Helium / localcofhe only]
 │
 ├─ resolveLoanApproval(loanId)   → polls FHE.getDecryptResultSafe(ebool)
 │    → if approved: _disburseLoan()   → ETH sent to borrower
 │    → if rejected: loan stays Pending
 │
 └─ repayLoan(loanId)             → interest distributed to lenders
      → lenderYieldEarned[lender] += share
      → ReputationRegistry.notifyActivity(borrower)
```

---

## Network Compatibility

Shadow Credit is deployed on Base Sepolia for contract verification. Full FHE operations require a CoFHE-enabled network.

| Operation | Base Sepolia | Fhenix Helium | localcofhe |
|---|---|---|---|
| `register()` | ✅ | ✅ | ✅ |
| `computeCreditScore()` | ✅ | ✅ | ✅ |
| `submitCreditData()` (FHE) | ⚠️ needs CoFHE SDK | ✅ | ✅ |
| `requestScoreDecryption()` | ❌ no task manager | ✅ | ✅ |
| `requestLoan()` V3 | ❌ FHE.gte() reverts | ✅ | ✅ |
| `requestDecryption()` (reputation) | ❌ no task manager | ✅ | ✅ |
| Fund pool / withdraw | ✅ | ✅ | ✅ |
| Create/cancel delegation offers | ✅ | ✅ | ✅ |
| Repay loans and bonds | ✅ | ✅ | ✅ |

**Why:** `FHE.decrypt()` and `FHE.gte()` route through the CoFHE `ITaskManager`. The task manager contract is only deployed on Fhenix Helium (chain ID 8008135) and localcofhe (chain ID 412346). Base Sepolia is used for contract deployment and non-FHE interactions.

**Frontend handling:** The UI detects the connected chain via `isFHENetwork` and:
- Blocks `requestScoreDecryption()` before the wallet popup fires, showing a clear explanation
- Blocks `requestDecryption()` on the Reputation page with the same guard
- Shows a 🔐 locked ring with "Score Computed ✓" instead of a broken score display
- Warns on the Borrow page that V3 loan approval requires Fhenix Helium

---

## Wave 1 → Wave 2 → Wave 3

| Feature | Wave 1 | Wave 2 | Wave 3 |
|---|---|---|---|
| **Credit scoring** | Plaintext `uint256` stored on-chain | FHE `euint32` — computed in encrypted domain | + Score expiry (180d) + Score history array |
| **Loan approval** | `checkCreditThreshold()` returns plain `bool` | `ebool` from `FHE.gte()` — async decryption | + Stale score rejection + Loan refinancing |
| **Lender yield** | No yield tracking | No yield tracking | Proportional distribution per repayment + `claimYield()` |
| **Delegation yield** | `accumulatedYield` computed, never paid | Same | Yield transfers to delegator on `repayBond()` |
| **Reputation** | Not connected | Registry deployed, not wired | All 3 contracts call `notifyActivity()` automatically |
| **Score sharing** | Not available | Not available | `grantScoreAccess()` — user-controlled cross-protocol access |
| **Borrowing power** | Not available | Not available | `computeBorrowingPower()` — FHE arithmetic on income × risk factor |
| **Bond expiry** | No expiry | No expiry | `dueDate` + permissionless `markExpiredDefault()` |
| **ZK + FHE hybrid** | Not available | `CreditDataWithZK` deployed | Wired to V3 engine |
| **Data submission** | Plaintext | Real `InEuint*` ciphertexts | Same + CoFHE SDK integration documented |
| **Network gating** | Not applicable | Not applicable | `isFHENetwork` flag — UI blocks FHE-only actions on non-CoFHE chains |

---

## Documentation

All technical depth lives in `/docs`:

| Document | What's Inside |
|---|---|
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Three-contract design, full protocol flows, privacy model |
| [`SECURITY.md`](docs/SECURITY.md) | The 4 escrow invariants with Solidity code |
| [`AUDIT.md`](docs/AUDIT.md) | All 19 audit findings mapped to fixes |
| [`TESTS.md`](docs/TESTS.md) | Every test name, invariant test scenarios |
| [`API.md`](docs/API.md) | Complete function reference and roles |
| [`SDK.md`](docs/SDK.md) | Client-side integration with `@cofhe/sdk` |
| [`SETUP.md`](docs/SETUP.md) | Install, deploy, verify instructions |

---

## Roadmap

| Wave | Status | What Was Built |
|---|---|---|
| **Wave 1** | ✅ Complete | `SimpleCreditEngine` (plaintext scoring), `PrivateLoanPool` (plaintext approval), `CreditDelegation` (yield accumulates, not paid). Live on Base Sepolia. Proved the protocol concept end-to-end. |
| **Wave 2** | ✅ Complete | `EncryptedCreditEngineV2` (FHE scoring with real `InEuint*` ciphertexts), `PrivateLoanPoolV2` (ebool-gated disbursement — ETH never moves without FHE result), `CreditDataWithZK` (ZK range proofs + FHE hybrid). |
| **Wave 3** | ✅ Complete | `EncryptedCreditEngineV3` (score expiry, score history, borrowing power, cross-contract sharing), `PrivateLoanPoolV3` (lender yield distribution, loan refinancing), `CreditDelegationV2` (yield actually pays out, bond expiry), `ReputationRegistry` wired to all contracts. Network-aware frontend with `isFHENetwork` gating — FHE-only actions blocked gracefully on Base Sepolia. All deployed 2026-05-03. |
| **Wave 4** | 🔜 Planned | ERC-721 soulbound credit identity NFT. Score-gated governance. Multi-asset pools (ERC-20 collateral). Cross-chain score portability via LayerZero. |
| **Wave 5** | 🔜 Planned | Mainnet deployment. Institutional attestation network. Undercollateralized stablecoin backed by credit scores. DAO governance of pool parameters. |

---

## Why This Wins

**The core insight:** Every existing DeFi lending protocol treats privacy and verifiability as opposites. You either reveal your data (Aave, Compound) or you prove nothing (anonymous pools). Shadow Credit proves that FHE makes them compatible — you can verify creditworthiness without seeing the underlying data.

**The technical moat:**

1. **FHE arithmetic on-chain.** The credit score formula runs entirely on ciphertexts. `FHE.mul(paymentHistory, 255)`, `FHE.div(result, 10000)`, `FHE.select(FHE.gt(years, 10), 10, years)` — every operation is a homomorphic computation. The chain never sees a number.

2. **ebool-gated disbursement.** The loan approval is not a boolean stored by an owner. It is the result of `FHE.gte(encCreditScore, threshold)` — an encrypted comparison that produces an `ebool`. ETH is only disbursed when `FHE.getDecryptResultSafe(ebool)` returns `(true, true)`. There is no admin key that can override this.

3. **ZK + FHE hybrid.** The Circom circuit validates that input ranges are correct (paymentHistory ∈ [0, 10000], income ≥ debt) before the data is encrypted. This prevents garbage-in attacks without revealing the values.

4. **Composable credit identity.** `grantScoreAccess(recipient)` calls `FHE.allow(encCreditScore, recipient)`. Any authorized protocol can read the encrypted score handle and use it in their own FHE computations. Shadow Credit becomes a credit primitive, not a walled garden.

5. **Reputation that updates itself.** Every protocol action — computing a score, repaying a loan, repaying a bond — automatically calls `ReputationRegistry.notifyActivity()`. The composite reputation score is recomputed in FHE after every event. No user action required.

6. **Network-aware UI.** The frontend tracks `isFHENetwork` (true only on Fhenix Helium chain ID 8008135 and localcofhe 412346). Any action that calls `FHE.decrypt()` is intercepted before the wallet popup fires on non-CoFHE networks, with a clear explanation rather than a cryptic revert.

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-repo/shadow-credit-network
cd shadow-credit-network
npm install

# 2. Set deployer key
echo "PRIVATE_KEY=your_key_here" > .env

# 3. Deploy Wave 3 (writes frontend/.env.local automatically)
npx hardhat deploy-wave3 --network base-sepolia

# 4. Run frontend
cd frontend && npm install && npm run dev
```

**To use full FHE features** (score decryption, loan approval), run against localcofhe:

```bash
# Start local CoFHE node
npx hardhat node --network localcofhe

# Deploy to localcofhe
npx hardhat deploy-wave3 --network localcofhe

# Frontend auto-detects chain ID 412346 and enables FHE actions
cd frontend && npm run dev
```

---

## Project Structure

```
shadow-credit-network/
├── contracts/
│   ├── EncryptedCreditEngineV3.sol   # FHE credit scoring (Wave 3)
│   ├── PrivateLoanPoolV3.sol          # ebool-gated lending (Wave 3)
│   ├── CreditDelegationV2.sol         # Yield-paying delegation (Wave 3)
│   ├── ReputationRegistry.sol         # 6-factor FHE reputation
│   ├── CreditDataWithZK.sol           # ZK + FHE hybrid bridge
│   ├── SimpleCreditEngine.sol         # Plaintext engine (Wave 1, live)
│   ├── PrivateLoanPool.sol            # Plaintext pool (Wave 1, live)
│   └── CreditDelegation.sol           # Wave 1 delegation (live)
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── wallet.tsx             # MetaMask + Base Sepolia + isFHENetwork flag
│   │   │   ├── contracts.ts           # Address resolution, score formula
│   │   │   └── abis.ts                # All contract ABIs
│   │   ├── hooks/
│   │   │   ├── useCreditEngine.ts     # Register, submit, compute, decrypt (network-gated)
│   │   │   ├── useLoanPool.ts         # Fund, borrow, repay, yield
│   │   │   ├── useDelegation.ts       # Offers, bonds, expiry
│   │   │   └── useReputation.ts       # FHE reputation score (network-gated)
│   │   └── pages/app/
│   │       ├── Dashboard.tsx          # Score, risk tier, V3 features
│   │       ├── SubmitData.tsx         # 3-step credit data flow
│   │       ├── Borrow.tsx             # Lend/borrow/refinance
│   │       ├── Delegation.tsx         # Market + bond management
│   │       └── Reputation.tsx         # FHE composite score (encrypted state on Base Sepolia)
├── tasks/
│   └── deploy-wave3.ts               # Deploys all 5 contracts + writes .env.local
├── zk/
│   └── circuits/
│       └── credit_data_validator.circom  # Range proof circuit
└── docs/
    ├── ARCHITECTURE.md
    ├── SECURITY.md
    ├── AUDIT.md
    ├── TESTS.md
    ├── API.md
    ├── SDK.md
    └── SETUP.md
```

---

## License

MIT — built on Base Sepolia with Fhenix CoFHE.
