# API Reference

## EncryptedCreditEngineV3

**Address (Base Sepolia):** `0x5A03628A15674c425606e0D4710D66EBa8da09E6`

### Registration

| Function | Params | Returns | Access |
|---|---|---|---|
| `register()` | — | — | Anyone |
| `isRegistered(address)` | `user` | `bool` | View |

### Credit Data

| Function | Params | Returns | Access |
|---|---|---|---|
| `submitCreditData(InEuint64, InEuint64, InEuint32, InEuint32, InEuint32, InEuint32)` | income, totalDebt, paymentHistory, creditUtilization, accountAge, numDefaults | — | Registered |
| `computeCreditScore()` | — | — | Registered |
| `hasCreditScore(address)` | `user` | `bool` | View |
| `scoreComputedAt(address)` | `user` | `uint256` timestamp | View |
| `isScoreStale(address)` | `user` | `bool` | View |
| `scoreValidityPeriod()` | — | `uint256` seconds | View |

### Score Decryption

| Function | Params | Returns | Access |
|---|---|---|---|
| `requestScoreDecryption()` | — | — | Has score |
| `getDecryptedScore(address)` | `user` | `(uint32 score, bool isDecrypted)` | View |

### Borrowing Power (Wave 3)

| Function | Params | Returns | Access |
|---|---|---|---|
| `computeBorrowingPower()` | — | — | Has score |
| `hasBorrowingPower(address)` | `user` | `bool` | View |
| `getBorrowingPowerCtHash(address)` | `user` | `uint256` ctHash | View |

### Score History (Wave 3)

| Function | Params | Returns | Access |
|---|---|---|---|
| `getScoreHistoryLength(address)` | `user` | `uint256` | View |
| `getScoreHistoryAt(address, uint256)` | `user`, `index` | `uint256` ctHash | View |

### Loan Approval

| Function | Params | Returns | Access |
|---|---|---|---|
| `requestApprovalCheck(address, uint256)` | `user`, `minScore` | `(bytes32 checkId, uint256 eboolCtHash)` | Authorized contracts |
| `resolveApprovalCheck(bytes32)` | `checkId` | `(bool ready, bool approved)` | Anyone |
| `getApprovalCheckStatus(bytes32)` | `checkId` | `(exists, resolved, approved, user, minScore, eboolCtHash)` | View |

### Cross-Contract Sharing (Wave 3)

| Function | Params | Returns | Access |
|---|---|---|---|
| `grantScoreAccess(address)` | `recipient` | — | Has score, recipient authorized |
| `authorizeContract(address)` | `contract` | — | Owner |
| `revokeContract(address)` | `contract` | — | Owner |
| `getEncryptedScore(address)` | `user` | `euint32` | Authorized |

### Admin

| Function | Params | Access |
|---|---|---|
| `setScoreValidityPeriod(uint256)` | `period` (min 1 day) | Owner |
| `setReputationRegistry(address)` | `registry` | Owner |
| `updateThresholds(uint256, uint256, uint256, uint256)` | prime, nearPrime, subprime, minBorrow | Owner |

---

## PrivateLoanPoolV3

**Address (Base Sepolia):** `0x9227C5cC17A2C92fb44DB633C3327CF5E1246913`

### Lender Functions

| Function | Params | Returns | Access |
|---|---|---|---|
| `fundPool()` | payable ETH | — | Anyone (min 0.01 ETH) |
| `withdrawFunds(uint256)` | `amount` | — | Lender |
| `claimYield()` | — | — | Lender with accrued yield |
| `getLenderDeposit(address)` | `lender` | `(uint256 amount, uint256 depositedAt)` | View |
| `lenderYieldEarned(address)` | `lender` | `uint256` | View |

### Borrower Functions

| Function | Params | Returns | Access |
|---|---|---|---|
| `requestLoan(uint256, uint256, RiskPool)` | principal, duration (secs), riskPool (0/1/2) | — | Has fresh score |
| `resolveLoanApproval(uint256)` | `loanId` | — | Anyone |
| `repayLoan(uint256)` | `loanId`, payable ETH | — | Borrower |
| `refinanceLoan(uint256, RiskPool)` | `loanId`, `newPool` | — | Borrower, active loan, fresh score |

### Pool State

| Function | Returns |
|---|---|
| `totalPoolLiquidity()` | `uint256` |
| `totalLoanedOut()` | `uint256` |
| `totalInterestCollected()` | `uint256` |
| `getAvailableLiquidity()` | `uint256` |
| `loanCount()` | `uint256` |

### Loan Queries

| Function | Params | Returns |
|---|---|---|
| `getLoan(uint256)` | `loanId` | `(borrower, principal, totalOwed, repaidAmount, interestRate, dueDate, status)` |
| `getLoanApprovalStatus(uint256)` | `loanId` | `(approvalResolved, approvalPassed, checkId, eboolCtHash)` |
| `getBorrowerLoans(address)` | `borrower` | `uint256[]` loanIds |

### Risk Pool Parameters

| Pool | ID | APR | Min Score | Max Duration |
|---|---|---|---|---|
| Conservative | 0 | 3% | 740 | 90 days |
| Moderate | 1 | 8% | 670 | 180 days |
| Aggressive | 2 | 15% | 580 | 365 days |

---

## CreditDelegationV2

**Address (Base Sepolia):** `0xB60cA6232CD26CC74C5605C35E9EbecF4C882348`

### Offer Functions

| Function | Params | Access |
|---|---|---|
| `createOffer(uint256, uint256, uint256, uint256)` | maxAmount, yieldRate (bps), minScore, maxBonds | Anyone |
| `cancelOffer(uint256)` | `offerId` | Delegator |
| `acceptOffer(uint256, uint256, uint256)` | offerId, amount, duration (secs) | Anyone with sufficient score |
| `getOffer(uint256)` | `offerId` | View → `(delegator, maxAmount, yieldRate, minScore, available, activeBonds, maxBonds, status)` |
| `offerCount()` | — | View |
| `getDelegatorOffers(address)` | `delegator` | View → `uint256[]` |

### Bond Functions

| Function | Params | Access |
|---|---|---|
| `repayBond(uint256)` | `bondId`, payable ETH | Borrower |
| `markExpiredDefault(uint256)` | `bondId` | Anyone (after dueDate) |
| `getBond(uint256)` | `bondId` | View → `(delegator, borrower, amount, repaid, yieldEarned, yieldPaidOut, yieldRate, dueDate, status)` |
| `getBorrowerBonds(address)` | `borrower` | View → `uint256[]` |
| `isBondExpired(uint256)` | `bondId` | View → `bool` |
| `bondCount()` | — | View |

---

## ReputationRegistry

**Address (Base Sepolia):** `0xeecAb683D93a483669D797E4B7a06e8c286A25dC`

### User Functions

| Function | Params | Access |
|---|---|---|
| `register()` | — | Anyone |
| `requestDecryption()` | — | Registered |
| `getDecryptedScoreSafe()` | — | View → `(uint32 score, bool isDecrypted)` |
| `applyDecay(address)` | `user` | Anyone (after 90-day interval) |

### Queries

| Function | Params | Returns |
|---|---|---|
| `isRegistered(address)` | `user` | `bool` |
| `getRegisteredAt(address)` | `user` | `uint256` timestamp |
| `getLastActivityAt(address)` | `user` | `uint256` timestamp |
| `getActiveAttestationCount(address)` | `user` | `uint256` |
| `decayInterval()` | — | `uint256` seconds (default 90 days) |
| `minAttestations()` | — | `uint256` (default 2) |

### Integration Hook (Wave 3)

| Function | Params | Access |
|---|---|---|
| `notifyActivity(address)` | `user` | Authorized integration contracts only |

### Reputation Factors

| Index | Name | Weight | Direction |
|---|---|---|---|
| 0 | TransactionReliability | 30% | Higher = better |
| 1 | StakingHistory | 20% | Higher = better |
| 2 | GovernanceParticipation | 15% | Higher = better |
| 3 | ProtocolInteraction | 15% | Higher = better |
| 4 | SocialVerification | 10% | Higher = better |
| 5 | DefaultHistory | 10% | **Inverted** — higher = more defaults = worse |

---

## Events Reference

### EncryptedCreditEngineV3

```solidity
event UserRegistered(address indexed user)
event CreditDataSubmitted(address indexed user)
event CreditScoreComputed(address indexed user, uint256 scoreCtHash)
event ScoreDecryptionRequested(address indexed user, uint256 ctHash)
event BorrowingPowerComputed(address indexed user, uint256 powerCtHash)
event ApprovalCheckCreated(bytes32 indexed checkId, address indexed user, uint256 minScore, uint256 eboolCtHash)
event ApprovalCheckResolved(bytes32 indexed checkId, address indexed user, bool approved)
event ScoreAccessGranted(address indexed user, address indexed recipient)
```

### PrivateLoanPoolV3

```solidity
event PoolFunded(address indexed lender, uint256 amount)
event PoolWithdrawn(address indexed lender, uint256 amount)
event YieldClaimed(address indexed lender, uint256 amount)
event LoanRequested(address indexed borrower, uint256 indexed loanId, uint256 principal)
event LoanApprovalCheckRequested(address indexed borrower, uint256 indexed loanId, bytes32 indexed checkId, uint256 eboolCtHash)
event LoanApprovalResolved(address indexed borrower, uint256 indexed loanId, bool approved)
event LoanApproved(address indexed borrower, uint256 indexed loanId)
event LoanDisbursed(address indexed borrower, uint256 indexed loanId, uint256 amount)
event RepaymentMade(address indexed borrower, uint256 indexed loanId, uint256 amount, bool fullRepayment)
event LoanDefaulted(address indexed borrower, uint256 indexed loanId)
event LoanRefinanced(address indexed borrower, uint256 oldLoanId, uint256 newLoanId)
```

### CreditDelegationV2

```solidity
event DelegationOfferCreated(address indexed delegator, uint256 offerId)
event DelegationOfferCancelled(address indexed delegator, uint256 offerId)
event DelegationAccepted(address indexed delegator, address indexed borrower, uint256 offerId, uint256 bondId)
event DelegationRepaid(address indexed borrower, uint256 bondId, uint256 amount, bool fullRepayment)
event DelegationDefaulted(address indexed delegator, address indexed borrower, uint256 bondId)
event YieldPaidOut(address indexed delegator, uint256 bondId, uint256 amount)
```
