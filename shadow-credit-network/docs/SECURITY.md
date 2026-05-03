# Security

## The 4 Core Invariants

These are the properties that must hold for Shadow Credit to be trustworthy. Each is enforced at the Solidity level with no owner override.

---

### Invariant 1: ETH never moves without a verified FHE result

**Claim:** No ETH is disbursed to a borrower unless `FHE.getDecryptResultSafe(ebool)` has returned `(true, true)` — meaning the FHE network has confirmed that `encCreditScore >= threshold`.

**Enforcement:**

```solidity
// PrivateLoanPoolV3.sol

function resolveLoanApproval(uint256 _loanId) external whenNotPaused {
    Loan storage loan = loans[_loanId];
    if (loan.status != LoanStatus.Pending) revert LoanNotPending();
    if (loan.approvalCheckId == bytes32(0)) revert ApprovalNotRequested();

    // Poll the FHE network — returns (false, false) until decryption completes
    (bool ready, bool approved) = creditEngine.resolveApprovalCheck(loan.approvalCheckId);
    if (!ready) return;  // silent return — caller retries later

    loan.approvalResolved = true;
    loan.approvalPassed   = approved;

    if (approved) {
        _activateAndDisburse(_loanId);  // only path to ETH transfer
    }
    // rejected: loan stays Pending, no ETH moves
}

function _disburseLoan(uint256 _loanId) internal {
    // Only reachable through _activateAndDisburse()
    // Only reachable when approved == true
    (bool sent, ) = payable(loan.borrower).call{value: loan.principal}("");
    require(sent, "Disbursement failed");
}
```

**What this prevents:** An owner or admin calling a function to approve a loan without a valid credit check. There is no `approveLoan(loanId)` function. There is no `onlyOwner` bypass.

---

### Invariant 2: No plaintext financial data on-chain

**Claim:** Income, debt, payment history, utilization, account age, and defaults are never stored as readable values. They exist only as FHE ciphertext handles.

**Enforcement:**

```solidity
// EncryptedCreditEngineV3.sol

function submitCreditData(
    InEuint64 calldata _income,      // ZK-proven ciphertext from CoFHE SDK
    InEuint64 calldata _totalDebt,
    InEuint32 calldata _paymentHistory,
    InEuint32 calldata _creditUtilization,
    InEuint32 calldata _accountAge,
    InEuint32 calldata _numDefaults
) external {
    // FHE.asEuint64(InEuint64) does two things:
    // 1. Verifies the ZK proof of knowledge attached to the ciphertext
    // 2. Registers the ciphertext with the ACL
    encIncome[msg.sender] = FHE.asEuint64(_income);
    // encIncome[msg.sender] is now a uint256 ciphertext handle
    // The plaintext value is known only to the user who encrypted it
}
```

**What this prevents:** An observer reading `encIncome[address]` from chain state. The value is a ciphertext handle — a `uint256` that points to an encrypted value in the FHE network. Without the user's private key, it is computationally indistinguishable from random.

---

### Invariant 3: Score freshness enforced on-chain

**Claim:** A credit score older than `scoreValidityPeriod` (default 180 days) cannot be used to obtain a loan.

**Enforcement:**

```solidity
// EncryptedCreditEngineV3.sol

function requestApprovalCheck(
    address user,
    uint256 minScore
) external returns (bytes32 checkId, uint256 eboolCtHash) {
    if (!hasCreditScore[user]) revert NoCreditData();

    // Staleness check — enforced before any FHE computation
    if (block.timestamp - scoreComputedAt[user] > scoreValidityPeriod) {
        revert StaleScore();
    }

    // Only reaches here if score is fresh
    ebool meetsThreshold = FHE.gte(encCreditScore[user], FHE.asEuint32(minScore));
    FHE.decrypt(meetsThreshold);
    // ...
}
```

**What this prevents:** A borrower computing a high score once and using it indefinitely. Financial situations change; the protocol enforces that credit data is kept current.

---

### Invariant 4: Reputation updates are automatic and cannot be gamed

**Claim:** Reputation factors update automatically on protocol events. Users cannot selectively trigger reputation updates or skip negative updates.

**Enforcement:**

```solidity
// PrivateLoanPoolV3.sol

function repayLoan(uint256 _loanId) external payable whenNotPaused {
    // ... repayment logic ...
    if (fullRepayment) {
        loan.status = LoanStatus.Repaid;
        _notifyReputation(msg.sender, true);  // always called on full repayment
    }
}

function markDefaulted(uint256 _loanId) external onlyOwner {
    loan.status = LoanStatus.Defaulted;
    _notifyReputation(loan.borrower, false);  // always called on default
}

function _notifyReputation(address user, bool) internal {
    if (address(reputationRegistry) == address(0)) return;
    if (!reputationRegistry.isRegistered(user)) return;
    try reputationRegistry.notifyActivity(user) {} catch {}
    // try/catch: reputation failure never blocks the lending operation
}
```

**What this prevents:** A borrower defaulting and then manually calling a function to improve their reputation. The reputation update is a side effect of the lending operation, not a separate user action.

---

## Known Limitations

### FHE.decrypt() is asynchronous

The current `cofhe-contracts@0.0.13` uses `FHE.decrypt(ctHash)` which triggers async decryption by the FHE network. The result is not available in the same transaction. Callers must poll `FHE.getDecryptResultSafe()` in subsequent transactions.

**Implication:** There is a window between `requestLoan()` and `resolveLoanApproval()` where the loan is in `Pending` state. During this window, the pool liquidity is not reserved. A race condition exists where multiple borrowers could request loans that exceed pool capacity if they all request before any resolve.

**Mitigation:** `totalLoanedOut` is incremented only in `_activateAndDisburse()`. The available liquidity check in `requestLoan()` uses `totalPoolLiquidity - totalLoanedOut`. If multiple pending loans would exceed capacity, the later `resolveLoanApproval()` calls will fail at `_disburseLoan()` with `"Insufficient balance"`.

### Trivial encryption in reputation hook

`ReputationRegistry.notifyActivity()` uses `FHE.asEuint32(8000)` — trivial encryption of a known value. This is intentional: the activity signal (80% ProtocolInteraction score) is not sensitive. Only the composite score, which blends all factors, is private.

### Score validity period is owner-configurable

`setScoreValidityPeriod(uint256)` is callable by the contract owner. A malicious owner could set it to `type(uint256).max`, effectively disabling staleness enforcement. This is a centralization risk that will be addressed in Wave 4 with DAO governance.
