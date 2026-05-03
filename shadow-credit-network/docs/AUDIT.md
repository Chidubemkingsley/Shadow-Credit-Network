# Audit Findings

This document maps all 19 audit findings identified during internal review to their fixes. Each finding is categorized by severity and includes the contract, the issue, and the resolution.

---

## Critical (3)

### A-01: ETH disbursed before FHE result verified
**Contract:** `PrivateLoanPool` (Wave 1)
**Finding:** `_autoApproveIfQualified()` called `creditEngine.checkCreditThreshold()` which returned a plain `bool`. No FHE computation involved. Owner could set `creditEngine = address(0)` to auto-approve all loans.
**Fix:** `PrivateLoanPoolV3.resolveLoanApproval()` — disbursement gated on `FHE.getDecryptResultSafe(ebool)`. No owner override path exists.

### A-02: Delegation yield never paid out
**Contract:** `CreditDelegation` (Wave 1)
**Finding:** `repayBond()` computed `accumulatedYield` and stored it, but never transferred ETH to the delegator. Yield was permanently locked in the contract.
**Fix:** `CreditDelegationV2.repayBond()` — yield portion transferred to `bond.delegator` in the same transaction via `payable(bond.delegator).call{value: yieldOnPayment}("")`.

### A-03: submitCreditData accepted placeholder calldata
**Contract:** `EncryptedCreditEngine` (Wave 1)
**Finding:** The frontend passed trivially-encrypted values (`FHE.asEuint64(plaintext)`) from the client. These are not private — the plaintext is visible in the transaction calldata.
**Fix:** `EncryptedCreditEngineV3.submitCreditData()` takes `InEuint64 calldata` / `InEuint32 calldata`. `FHE.asEuint*(InEuint*)` verifies the CoFHE SDK ZK proof before accepting the ciphertext.

---

## High (5)

### A-04: No score expiry enforcement
**Contract:** `EncryptedCreditEngineV2`
**Finding:** A score computed years ago was treated identically to one computed today. Borrowers could compute a high score once and use it indefinitely.
**Fix:** `scoreComputedAt[user]` timestamp + `scoreValidityPeriod` (180 days). `requestApprovalCheck()` reverts with `StaleScore` if expired.

### A-05: Reputation registry disconnected
**Contract:** `ReputationRegistry`
**Finding:** The registry was deployed but no lending or delegation contract called it. Repayments and defaults had no reputation consequence.
**Fix:** All three Wave 3 contracts call `reputationRegistry.notifyActivity(user)` on repayment and default. The call is wrapped in `try/catch` so reputation failure never blocks lending.

### A-06: No lender yield distribution
**Contract:** `PrivateLoanPool` (Wave 1, Wave 2)
**Finding:** Interest collected on repayment was added to `totalPoolLiquidity` but not distributed to individual lenders. Lenders had no way to earn yield.
**Fix:** `PrivateLoanPoolV3._distributeYield()` — on each repayment, the interest portion is split proportionally across all lenders by deposit share. `claimYield()` pays out accrued yield.

### A-07: Bond expiry not enforced
**Contract:** `CreditDelegation` (Wave 1)
**Finding:** Bonds had no expiry date. A borrower could hold a bond indefinitely without repaying, with no mechanism for the delegator to recover.
**Fix:** `CreditDelegationV2` — `dueDate` field on each bond. `markExpiredDefault(bondId)` is permissionless and callable by anyone after `dueDate`.

### A-08: No credit score check on delegation acceptance
**Contract:** `CreditDelegation` (Wave 1)
**Finding:** `acceptOffer()` did not verify the borrower's credit score against `offer.minCreditScore`. Any wallet could accept any offer regardless of creditworthiness.
**Fix:** `CreditDelegationV2.acceptOffer()` calls `_checkCreditScore(msg.sender, offer.minCreditScore)` via `staticcall` to the credit engine. Reverts with `InsufficientCreditScore` if not met.

---

## Medium (7)

### A-09: Score history not tracked
**Finding:** No record of past scores. Users could not prove score improvement to third parties.
**Fix:** `scoreHistory[user]` array in `EncryptedCreditEngineV3`. Each `computeCreditScore()` appends the ciphertext handle. Users can prove trajectory via `getScoreHistoryAt()`.

### A-10: No cross-contract score sharing
**Finding:** Third-party protocols had no way to read a user's encrypted score.
**Fix:** `authorizeContract()` + `grantScoreAccess(recipient)` — user-controlled, calls `FHE.allow(encCreditScore, recipient)`.

### A-11: Borrowing power not computed
**Finding:** The protocol had no on-chain representation of how much a user could borrow based on their encrypted income and risk tier.
**Fix:** `computeBorrowingPower()` in `EncryptedCreditEngineV3` — FHE arithmetic on `income × riskFactor / 10000 - totalDebt`.

### A-12: No loan refinancing
**Finding:** Borrowers with active loans could not restructure their debt at better terms if their credit score improved.
**Fix:** `refinanceLoan(loanId, newPool)` in `PrivateLoanPoolV3` — closes active loan, opens new one with remaining balance, goes through full FHE approval flow.

### A-13: ABI InEuint tuple incorrectly defined
**Finding:** Frontend ABI defined `InEuint*` as `tuple(uint256,uint8,uint8,bytes)` without field names. ethers.js serialisation was ambiguous.
**Fix:** Named fields: `tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature)` matching the Solidity struct layout exactly.

### A-14: Wallet connect not prominent
**Finding:** Wallet connection was buried in the sidebar. Users navigating to `/app` without a wallet saw an empty state with no clear action.
**Fix:** Dashboard shows a full-screen connect prompt with a large `Connect Wallet` button when not connected.

### A-15: App name inconsistent
**Finding:** App was named "CreditFi" in the sidebar, landing page hero, and footer. The project is "Shadow Credit Network".
**Fix:** All three locations updated to "Shadow Credit" / "Shadow Credit Network".

---

## Low (4)

### A-16: `useZkSubmitter` fully stubbed
**Finding:** The ZK submitter hook returned `null` for all functions with "not available" errors.
**Fix:** `useZkSubmitter.ts` now calls `snarkjs.groth16.fullProve()` with the circuit WASM/zkey, encrypts via CoFHE SDK, and submits to `CreditDataWithZK.submitWithProof()`.

### A-17: `getLoanStatus` missing from V2 pool ABI
**Finding:** `useLoanPool.ts` called `contract.getLoanStatus(i)` but the V2 pool ABI didn't include this function.
**Fix:** ABI updated. V3 pool uses `getLoan()` which returns status as the 7th return value.

### A-18: Delegation `getOffer` return tuple mismatch
**Finding:** V1 `getOffer` returns 8 values; V2 returns the same 8 but with different field semantics. Frontend was using V1 indices for V2 data.
**Fix:** `useDelegation.ts` uses named destructuring with explicit index mapping for both V1 and V2.

### A-19: `repayLoan` event signature changed in V3
**Finding:** V1 `RepaymentMade(address, uint256, uint256)` vs V3 `RepaymentMade(address, uint256, uint256, bool)` — the `fullRepayment` bool was added. Frontend event listeners would fail to decode V3 events.
**Fix:** ABI updated with the correct V3 signature including `bool fullRepayment`.
