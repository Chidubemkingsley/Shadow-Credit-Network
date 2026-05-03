# Architecture

## Overview

Shadow Credit Network is a three-layer protocol:

1. **Credit layer** — `EncryptedCreditEngineV3` computes credit scores in the FHE domain
2. **Lending layer** — `PrivateLoanPoolV3` gates ETH disbursement on a verified FHE result
3. **Identity layer** — `ReputationRegistry` maintains a 6-factor encrypted reputation score

These three contracts are wired together at deployment. Every protocol action flows through all three.

---

## Contract Dependency Graph

```
User
 │
 ├──► EncryptedCreditEngineV3
 │         │
 │         ├── stores: encIncome, encTotalDebt, encPaymentHistory,
 │         │           encCreditUtilization, encAccountAge, encNumDefaults
 │         │           (all euint64/euint32 ciphertext handles)
 │         │
 │         ├── computes: encCreditScore (euint32)
 │         │             encBorrowingPower (euint64)
 │         │
 │         ├── produces: ApprovalCheck { ebool result, bytes32 checkId }
 │         │
 │         └──► ReputationRegistry.notifyActivity()
 │
 ├──► PrivateLoanPoolV3
 │         │
 │         ├── calls: creditEngine.requestApprovalCheck()
 │         │          creditEngine.resolveApprovalCheck()
 │         │
 │         ├── disburses: ETH only when ebool resolves to true
 │         │
 │         ├── distributes: yield proportionally to lenders
 │         │
 │         └──► ReputationRegistry.notifyActivity()
 │
 ├──► CreditDelegationV2
 │         │
 │         ├── checks: creditEngine.checkCreditThreshold() on acceptOffer()
 │         │
 │         ├── transfers: yield to delegator on repayBond()
 │         │
 │         └──► ReputationRegistry.notifyActivity()
 │
 └──► CreditDataWithZK
           │
           ├── verifies: Groth16 ZK proof (input range validity)
           └── forwards: InEuint* ciphertexts to EncryptedCreditEngineV3
```

---

## Privacy Model

### What is encrypted

| Data | Type | Who can read |
|---|---|---|
| Income | `euint64` | User only (via `FHE.allowSender`) |
| Total debt | `euint64` | User only |
| Payment history | `euint32` | User only |
| Credit utilization | `euint32` | User only |
| Account age | `euint32` | User only |
| Number of defaults | `euint32` | User only |
| Credit score | `euint32` | User + authorized contracts |
| Borrowing power | `euint64` | User only |
| Reputation factors | `euint32[6]` | User only |
| Composite reputation | `euint32` | User only |
| Loan approval result | `ebool` | Contract only (via `FHE.allowThis`) |

### What is public

| Data | Why public |
|---|---|
| Registration status | Required for protocol participation |
| `hasCreditScore` flag | Required for loan eligibility check |
| `scoreComputedAt` timestamp | Required for staleness enforcement |
| Score history length | Proves trajectory without revealing values |
| Loan principal, duration, status | Standard lending transparency |
| Pool liquidity totals | Required for borrower capacity planning |
| Offer parameters (yield rate, min score) | Required for market discovery |

### ACL (Access Control List)

Every ciphertext in CoFHE has an ACL. Access is granted explicitly:

```solidity
FHE.allowThis(ctHash)      // contract can use it in future computations
FHE.allowSender(ctHash)    // msg.sender can decrypt it off-chain
FHE.allow(ctHash, addr)    // specific address can decrypt it
```

Without an explicit `allow`, no one — including the contract owner — can read the value.

---

## Full Protocol Flows

### Flow 1: Credit Score Computation

```
1. register()
   → isRegistered[msg.sender] = true

2. submitCreditData(InEuint64 income, ..., InEuint32 numDefaults)
   → FHE.asEuint64(income) verifies ZK proof, registers ciphertext
   → encIncome[msg.sender] = ciphertext handle
   → FHE.allowThis() + FHE.allowSender() for each field

3. computeCreditScore()
   → paymentScore = FHE.div(FHE.mul(paymentHistory, 255), 10000)
   → utilScore    = FHE.div(FHE.mul(FHE.sub(10000, utilization), 120), 10000)
   → ageScore     = FHE.mul(FHE.select(FHE.gt(years, 10), 10, years), 15)
   → penalty      = FHE.mul(defaults, 50)
   → total        = 300 + paymentScore + utilScore + ageScore - penalty
   → finalScore   = FHE.select(lt(total,300), 300, FHE.select(gt(total,850), 850, total))
   → encCreditScore[msg.sender] = finalScore
   → scoreComputedAt[msg.sender] = block.timestamp
   → scoreHistory[msg.sender].push(euint32.unwrap(finalScore))
   → ReputationRegistry.notifyActivity(msg.sender)

4. requestScoreDecryption()
   → FHE.decrypt(encCreditScore[msg.sender])
   → async: FHE network decrypts

5. getDecryptedScore(address)
   → FHE.getDecryptResultSafe(encCreditScore[user])
   → returns (score, isDecrypted)
   → poll until isDecrypted == true
```

### Flow 2: Loan Approval (ebool-gated)

```
1. requestLoan(principal, duration, riskPool)
   → validates: principal in [0.01, 100] ETH
   → validates: creditEngine.hasCreditScore(msg.sender)
   → validates: !creditEngine.isScoreStale(msg.sender)
   → calls: creditEngine.requestApprovalCheck(msg.sender, minScore)
     → FHE.gte(encCreditScore[user], FHE.asEuint32(minScore)) → ebool
     → FHE.decrypt(ebool) triggers async decryption
     → returns (checkId, eboolCtHash)
   → loan.status = Pending
   → emits: LoanApprovalCheckRequested(borrower, loanId, checkId, eboolCtHash)

2. resolveLoanApproval(loanId)  [permissionless — anyone can call]
   → calls: creditEngine.resolveApprovalCheck(checkId)
     → FHE.getDecryptResultSafe(ebool)
     → if not ready: return (false, false)
     → if ready: store result, return (true, approved)
   → if !ready: return silently (retry later)
   → if approved: _activateAndDisburse(loanId)
     → loan.status = Active
     → ETH transferred to borrower
   → if rejected: loan stays Pending, approvalPassed = false
```

### Flow 3: Lender Yield Distribution

```
repayLoan(loanId) [payable]
   → loan.repaidAmount += msg.value
   → interestPortion = totalOwed - principal
   → interestShare = msg.value * interestPortion / totalOwed
   → _distributeYield(interestShare):
     for each lender:
       share = interestShare * lenderDeposit / totalPoolLiquidity
       lenderYieldEarned[lender] += share
   → totalInterestCollected += interestShare
   → if fullRepayment: ReputationRegistry.notifyActivity(borrower)

claimYield()
   → yield = lenderYieldEarned[msg.sender]
   → lenderYieldEarned[msg.sender] = 0
   → ETH transferred to lender
```

---

## Score Formula

The formula is deterministic and can be previewed client-side before submitting:

```
paymentScore  = (paymentHistory × 255) / 10000        max 255 pts
utilScore     = ((10000 − utilization) × 120) / 10000  max 120 pts
ageScore      = min(accountAge / 365, 10) × 15         max 150 pts
penalty       = numDefaults × 50

rawScore = 300 + paymentScore + utilScore + ageScore − penalty
score    = clamp(rawScore, 300, 850)
```

**Risk tiers:**

| Tier | Score Range | Borrowing Factor |
|---|---|---|
| Prime | 740–850 | 50% of income |
| Near Prime | 670–739 | 30% of income |
| Subprime | 580–669 | 15% of income |
| Deep Subprime | 300–579 | 5% of income |
