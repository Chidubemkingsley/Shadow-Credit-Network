# Tests

## Test Files

| File | Contract | Tests |
|---|---|---|
| `test/EncryptedCreditEngine.test.ts` | `EncryptedCreditEngine` (V1) | 18 |
| `test/PrivateLoanPool.test.ts` | `PrivateLoanPool` (V1) | 12 |
| `test/CreditDelegation.test.ts` | `CreditDelegation` (V1) | 9 |
| `test/ReputationRegistry.test.ts` | `ReputationRegistry` | 11 |
| `test/ZKVerifier.test.ts` | `Groth16Verifier` | 6 |
| `test/Counter.test.ts` | `Counter` | 3 |

---

## EncryptedCreditEngine Tests

### Deployment
- `Should set the correct owner`
- `Should set the correct fee receiver`
- `Should revert with zero address fee receiver`

### Registration
- `Should register a new user`
- `Should increment user count on registration`
- `Should store user in index`
- `Should revert if already registered`

### Credit Data Submission
- `Should submit encrypted credit data`
- `Should revert if not registered`

### Credit Score Computation
- `Should compute credit score with good credit data`
- `Should compute score for user with defaults (lower score)`
- `Should revert if credit data not submitted`
- `Should allow cofhejs unsealing of score` — unseals the euint32 handle and verifies score ∈ [300, 850]

### Score Decryption
- `Should request score decryption`
- `Should get decrypted score after request`
- `Should revert if score not computed before decryption request`

### Borrowing Power
- `Should compute borrowing power for user with score`
- `Should revert if score not computed`

### Delegation
- `Should authorize a delegate`
- `Should revoke a delegate`
- `Should not allow self-delegation`
- `Should not allow duplicate delegation`
- `Should revert revoking non-existent delegate`
- `Should revert delegating when not registered`

### Admin Functions
- `Should allow owner to update fee receiver`
- `Should not allow non-owner to update fee receiver`
- `Should allow owner to update thresholds`
- `Should not allow non-owner to update thresholds`

### Full Flow Integration
- `Should complete full credit lifecycle` — register → submit → compute → borrowing power → delegate → decrypt

---

## Invariant Test Scenarios

These scenarios test the core security invariants:

### Invariant 1: ETH never moves without FHE result

```
Scenario: Loan requested, FHE not yet decrypted
  Given: requestLoan() called, approvalCheckId set
  When:  resolveLoanApproval() called before FHE decrypts
  Then:  function returns silently, loan stays Pending, no ETH moves

Scenario: Loan requested, FHE decrypts to false
  Given: requestLoan() called, score below threshold
  When:  resolveLoanApproval() called after FHE decrypts
  Then:  approvalPassed = false, loan stays Pending, no ETH moves

Scenario: Loan requested, FHE decrypts to true
  Given: requestLoan() called, score above threshold
  When:  resolveLoanApproval() called after FHE decrypts
  Then:  loan.status = Active, ETH transferred to borrower
```

### Invariant 2: No plaintext on-chain

```
Scenario: submitCreditData with real InEuint* ciphertexts
  Given: cofhejs.encrypt([Encryptable.uint64(100_000n)]) called
  When:  submitCreditData(encIncome, ...) called
  Then:  encIncome[user] = ciphertext handle (uint256)
         plaintext 100_000 is NOT readable from chain state

Scenario: computeCreditScore with encrypted inputs
  Given: encPaymentHistory[user] = ciphertext of 9500
  When:  computeCreditScore() called
  Then:  all intermediate values are euint32 ciphertexts
         no plaintext intermediate values exist on-chain
```

### Invariant 3: Score freshness

```
Scenario: Score computed, 181 days pass, loan requested
  Given: computeCreditScore() called at T=0
         scoreValidityPeriod = 180 days
  When:  requestLoan() called at T=181 days
  Then:  revert StaleScore()

Scenario: Score recomputed, loan requested immediately
  Given: computeCreditScore() called at T=181 days
  When:  requestLoan() called at T=181 days + 1 block
  Then:  requestApprovalCheck() proceeds normally
```

### Invariant 4: Reputation auto-updates

```
Scenario: Full loan repayment
  Given: borrower registered in ReputationRegistry
         loan.status = Active
  When:  repayLoan() called with full amount
  Then:  loan.status = Repaid
         ReputationRegistry.notifyActivity(borrower) called
         ProtocolInteraction factor updated

Scenario: Loan defaulted
  Given: borrower registered in ReputationRegistry
         loan.status = Active
  When:  markDefaulted() called by owner
  Then:  loan.status = Defaulted
         ReputationRegistry.notifyActivity(borrower) called
```

---

## Running Tests

```bash
# Requires localcofhe for FHE operations
npm run localcofhe:start  # in separate terminal

# Run all tests
npm run localcofhe:test

# Run specific file
npx hardhat test test/EncryptedCreditEngine.test.ts --network localcofhe

# Run with gas reporting
REPORT_GAS=true npx hardhat test --network localcofhe
```

---

## Test Environment

Tests use `cofhejs/node` for FHE operations in the mock environment:

```typescript
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'

// Initialize with hardhat signer
await hre.cofhe.initializeWithHardhatSigner(alice)

// Encrypt a value
const [encValue] = await cofhejs.encrypt([Encryptable.uint32(9500n)])

// Unseal a ciphertext handle
const result = await cofhejs.unseal(ctHash, FheTypes.Uint32)
const plaintext = Number(result.data)
```

Tests skip automatically if not running in the mock environment:

```typescript
beforeEach(function () {
  if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
})
```
