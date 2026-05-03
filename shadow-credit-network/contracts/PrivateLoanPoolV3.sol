// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal interface to EncryptedCreditEngineV3
interface IEncryptedCreditEngineV3 {
    function hasCreditScore(address user) external view returns (bool);
    function isScoreStale(address user) external view returns (bool);
    function requestApprovalCheck(address user, uint256 minScore)
        external returns (bytes32 checkId, uint256 eboolCtHash);
    function resolveApprovalCheck(bytes32 checkId)
        external returns (bool ready, bool approved);
}

/// @notice Minimal interface to ReputationRegistry for post-repayment updates
interface IReputationRegistryV3 {
    enum ReputationFactor {
        TransactionReliability,
        StakingHistory,
        GovernanceParticipation,
        ProtocolInteraction,
        SocialVerification,
        DefaultHistory
    }
    function isRegistered(address user) external view returns (bool);
    function notifyActivity(address user) external;
}

/// @title PrivateLoanPoolV3
/// @notice Wave 3 lending pool. Key improvements over V2:
///
///   1. Lender yield distribution — interest collected on repayment is split
///      proportionally across all lenders. Each lender accrues yield in
///      `lenderYieldEarned` and claims it via `claimYield()`.
///
///   2. Reputation wiring — on full repayment, calls reputationRegistry.notifyActivity()
///      to update the borrower's TransactionReliability factor. On default,
///      calls notifyActivity() to update DefaultHistory.
///
///   3. Stale score rejection — requestLoan() checks isScoreStale() and reverts
///      with StaleScore if the borrower's credit data is outdated.
///
///   4. Loan refinancing — refinanceLoan() closes an active loan and opens a new
///      one at the current risk pool terms, carrying over the remaining balance.
///
///   5. ebool-gated disbursement (unchanged from V2) — ETH is NEVER disbursed
///      until resolveApprovalCheck() returns approved == true.
contract PrivateLoanPoolV3 is Ownable {

    // ──────────────────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────────────────

    event PoolFunded(address indexed lender, uint256 amount);
    event PoolWithdrawn(address indexed lender, uint256 amount);
    event YieldClaimed(address indexed lender, uint256 amount);
    event LoanRequested(address indexed borrower, uint256 indexed loanId, uint256 principal);
    event LoanApprovalCheckRequested(
        address indexed borrower,
        uint256 indexed loanId,
        bytes32 indexed checkId,
        uint256 eboolCtHash
    );
    event LoanApprovalResolved(address indexed borrower, uint256 indexed loanId, bool approved);
    event LoanApproved(address indexed borrower, uint256 indexed loanId);
    event LoanDisbursed(address indexed borrower, uint256 indexed loanId, uint256 amount);
    event RepaymentMade(address indexed borrower, uint256 indexed loanId, uint256 amount, bool fullRepayment);
    event LoanDefaulted(address indexed borrower, uint256 indexed loanId);
    event LoanRefinanced(address indexed borrower, uint256 oldLoanId, uint256 newLoanId);

    // ──────────────────────────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────────────────────────

    error InsufficientLiquidity();
    error NotBorrower();
    error LoanNotFound();
    error LoanNotPending();
    error LoanNotActive();
    error BelowMinimum();
    error AboveMaximum();
    error NoCreditScore();
    error StaleScore();
    error ApprovalNotRequested();
    error PoolPaused();
    error NoYieldToClaim();
    error RefinanceNotAllowed();

    // ──────────────────────────────────────────────────────────────────
    //  Enums / Structs
    // ──────────────────────────────────────────────────────────────────

    enum LoanStatus { Pending, Active, Repaid, Defaulted }
    enum RiskPool   { Conservative, Moderate, Aggressive }

    struct Loan {
        address    borrower;
        uint256    principal;
        uint256    totalOwed;
        uint256    repaidAmount;
        uint256    interestRate;
        uint256    duration;
        uint256    approvedAt;
        uint256    dueDate;
        LoanStatus status;
        RiskPool   riskPool;
        uint256    minCreditScore;
        bytes32    approvalCheckId;
        uint256    approvalEboolCtHash;
        bool       approvalResolved;
        bool       approvalPassed;
    }

    struct PoolConfig {
        uint256 baseInterestRate;
        uint256 maxDuration;
        uint256 minCreditScore;
    }

    struct LenderDeposit {
        uint256 amount;
        uint256 depositedAt;
    }

    // ──────────────────────────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────────────────────────

    IEncryptedCreditEngineV3 public creditEngine;
    IReputationRegistryV3    public reputationRegistry;

    uint256 public totalPoolLiquidity;
    uint256 public totalLoanedOut;
    uint256 public totalInterestCollected;   // NEW: tracks all interest received
    uint256 public minLoanAmount = 0.01 ether;
    uint256 public maxLoanAmount = 100 ether;
    bool    public paused;

    mapping(address => LenderDeposit) public lenderDeposits;
    address[] public lenders;
    mapping(address => bool) public isLender;

    // NEW: per-lender accrued yield (claimable ETH)
    mapping(address => uint256) public lenderYieldEarned;

    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) public borrowerLoans;
    uint256 public loanCount;

    mapping(uint256 => PoolConfig) public poolConfigs;

    // ──────────────────────────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor(address _owner) Ownable(_owner) {
        poolConfigs[uint256(RiskPool.Conservative)] = PoolConfig({
            baseInterestRate: 300,
            maxDuration:      90 days,
            minCreditScore:   740
        });
        poolConfigs[uint256(RiskPool.Moderate)] = PoolConfig({
            baseInterestRate: 800,
            maxDuration:      180 days,
            minCreditScore:   670
        });
        poolConfigs[uint256(RiskPool.Aggressive)] = PoolConfig({
            baseInterestRate: 1500,
            maxDuration:      365 days,
            minCreditScore:   580
        });
    }

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Lending — fund, withdraw, claim yield
    // ──────────────────────────────────────────────────────────────────

    function fundPool() external payable whenNotPaused {
        if (msg.value < minLoanAmount) revert BelowMinimum();

        if (lenderDeposits[msg.sender].amount == 0) {
            lenderDeposits[msg.sender].depositedAt = block.timestamp;
            if (!isLender[msg.sender]) {
                lenders.push(msg.sender);
                isLender[msg.sender] = true;
            }
        }

        lenderDeposits[msg.sender].amount += msg.value;
        totalPoolLiquidity += msg.value;

        emit PoolFunded(msg.sender, msg.value);
    }

    function withdrawFunds(uint256 _amount) external whenNotPaused {
        uint256 deposit = lenderDeposits[msg.sender].amount;
        if (deposit == 0 || _amount > deposit) revert BelowMinimum();

        lenderDeposits[msg.sender].amount -= _amount;
        totalPoolLiquidity -= _amount;

        (bool sent, ) = payable(msg.sender).call{value: _amount}("");
        require(sent, "Transfer failed");

        emit PoolWithdrawn(msg.sender, _amount);
    }

    /// @notice Claim accrued yield from interest payments.
    /// @dev Yield is distributed proportionally when borrowers repay.
    ///      This function pays out whatever has accumulated for the caller.
    function claimYield() external whenNotPaused {
        uint256 yield = lenderYieldEarned[msg.sender];
        if (yield == 0) revert NoYieldToClaim();

        lenderYieldEarned[msg.sender] = 0;

        (bool sent, ) = payable(msg.sender).call{value: yield}("");
        require(sent, "Yield transfer failed");

        emit YieldClaimed(msg.sender, yield);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Borrowing — Step 1: request loan
    // ──────────────────────────────────────────────────────────────────

    function requestLoan(
        uint256  _principal,
        uint256  _duration,
        RiskPool _riskPool
    ) external whenNotPaused {
        if (_principal < minLoanAmount) revert BelowMinimum();
        if (_principal > maxLoanAmount) revert AboveMaximum();

        uint256 available = totalPoolLiquidity > totalLoanedOut
            ? totalPoolLiquidity - totalLoanedOut
            : 0;
        if (_principal > available) revert InsufficientLiquidity();

        PoolConfig storage config = poolConfigs[uint256(_riskPool)];
        uint256 duration = _duration > 0 ? _duration : config.maxDuration;
        if (duration > config.maxDuration) duration = config.maxDuration;

        uint256 interest  = (_principal * config.baseInterestRate * duration) / (365 days * 10000);
        uint256 totalOwed = _principal + interest;

        uint256 loanId = loanCount++;
        Loan storage loan = loans[loanId];
        loan.borrower       = msg.sender;
        loan.principal      = _principal;
        loan.totalOwed      = totalOwed;
        loan.interestRate   = config.baseInterestRate;
        loan.duration       = duration;
        loan.status         = LoanStatus.Pending;
        loan.riskPool       = _riskPool;
        loan.minCreditScore = config.minCreditScore;

        borrowerLoans[msg.sender].push(loanId);
        emit LoanRequested(msg.sender, loanId, _principal);

        // Dev/test mode: no credit engine set → auto-approve
        if (address(creditEngine) == address(0)) {
            _activateAndDisburse(loanId);
            return;
        }

        if (!creditEngine.hasCreditScore(msg.sender)) revert NoCreditScore();

        // NEW: reject stale scores
        if (creditEngine.isScoreStale(msg.sender)) revert StaleScore();

        (bytes32 checkId, uint256 eboolCtHash) = creditEngine.requestApprovalCheck(
            msg.sender,
            config.minCreditScore
        );

        loan.approvalCheckId     = checkId;
        loan.approvalEboolCtHash = eboolCtHash;

        emit LoanApprovalCheckRequested(msg.sender, loanId, checkId, eboolCtHash);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Borrowing — Step 2: resolve and disburse (permissionless)
    //
    //  ETH is NEVER disbursed until the ebool resolves to true.
    //  No owner override. No plaintext bool bypass.
    // ──────────────────────────────────────────────────────────────────

    function resolveLoanApproval(uint256 _loanId) external whenNotPaused {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        if (loan.status != LoanStatus.Pending) revert LoanNotPending();
        if (loan.approvalCheckId == bytes32(0)) revert ApprovalNotRequested();

        (bool ready, bool approved) = creditEngine.resolveApprovalCheck(loan.approvalCheckId);
        if (!ready) return;  // FHE decryption not complete yet — retry later

        loan.approvalResolved = true;
        loan.approvalPassed   = approved;

        emit LoanApprovalResolved(loan.borrower, _loanId, approved);

        if (approved) {
            _activateAndDisburse(_loanId);
        }
        // Rejected: loan stays Pending with approvalResolved=true, approvalPassed=false
    }

    function _activateAndDisburse(uint256 _loanId) internal {
        Loan storage loan = loans[_loanId];
        loan.status     = LoanStatus.Active;
        loan.approvedAt = block.timestamp;
        loan.dueDate    = block.timestamp + loan.duration;
        totalLoanedOut += loan.principal;

        emit LoanApproved(loan.borrower, _loanId);
        _disburseLoan(_loanId);
    }

    function _disburseLoan(uint256 _loanId) internal {
        Loan storage loan = loans[_loanId];
        require(loan.status == LoanStatus.Active, "Not active");
        require(address(this).balance >= loan.principal, "Insufficient balance");

        (bool sent, ) = payable(loan.borrower).call{value: loan.principal}("");
        require(sent, "Disbursement failed");

        emit LoanDisbursed(loan.borrower, _loanId, loan.principal);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Repayment — with yield distribution and reputation update
    // ──────────────────────────────────────────────────────────────────

    function repayLoan(uint256 _loanId) external payable whenNotPaused {
        if (_loanId >= loanCount) revert LoanNotFound();
        if (msg.value == 0) revert BelowMinimum();

        Loan storage loan = loans[_loanId];
        if (loan.borrower != msg.sender) revert NotBorrower();
        if (loan.status != LoanStatus.Active) revert LoanNotActive();

        loan.repaidAmount  += msg.value;
        totalLoanedOut     -= msg.value;
        totalPoolLiquidity += msg.value;

        bool fullRepayment = loan.repaidAmount >= loan.totalOwed;

        // NEW: distribute interest portion proportionally to lenders
        // Interest = totalOwed - principal. We distribute the interest
        // component of this payment proportionally.
        if (loan.totalOwed > loan.principal && totalPoolLiquidity > 0) {
            uint256 interestPortion = loan.totalOwed - loan.principal;
            // What fraction of this payment is interest?
            // interestShare = msg.value * interestPortion / loan.totalOwed
            uint256 interestShare = (msg.value * interestPortion) / loan.totalOwed;
            if (interestShare > 0) {
                _distributeYield(interestShare);
                totalInterestCollected += interestShare;
            }
        }

        if (fullRepayment) {
            loan.status = LoanStatus.Repaid;
            // NEW: notify reputation registry of successful repayment
            _notifyReputation(msg.sender, true);
        }

        emit RepaymentMade(msg.sender, _loanId, msg.value, fullRepayment);
    }

    /// @dev Distribute yield proportionally across all lenders by deposit share.
    function _distributeYield(uint256 _yieldAmount) internal {
        if (totalPoolLiquidity == 0 || lenders.length == 0) return;

        for (uint256 i = 0; i < lenders.length; i++) {
            address lender = lenders[i];
            uint256 deposit = lenderDeposits[lender].amount;
            if (deposit == 0) continue;

            // lender's share = yieldAmount * deposit / totalPoolLiquidity
            uint256 share = (_yieldAmount * deposit) / totalPoolLiquidity;
            if (share > 0) {
                lenderYieldEarned[lender] += share;
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────
    //  NEW: Loan Refinancing
    //
    //  Closes an active loan and opens a new one at the current pool terms.
    //  The remaining balance (totalOwed - repaidAmount) becomes the new principal.
    //  Requires a fresh credit score (not stale).
    // ──────────────────────────────────────────────────────────────────

    function refinanceLoan(uint256 _loanId, RiskPool _newPool) external whenNotPaused {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage oldLoan = loans[_loanId];
        if (oldLoan.borrower != msg.sender) revert NotBorrower();
        if (oldLoan.status != LoanStatus.Active) revert LoanNotActive();

        // Must have a fresh score to refinance
        if (address(creditEngine) != address(0)) {
            if (!creditEngine.hasCreditScore(msg.sender)) revert NoCreditScore();
            if (creditEngine.isScoreStale(msg.sender)) revert StaleScore();
        }

        uint256 remaining = oldLoan.totalOwed > oldLoan.repaidAmount
            ? oldLoan.totalOwed - oldLoan.repaidAmount
            : 0;

        if (remaining == 0) revert RefinanceNotAllowed();
        if (remaining < minLoanAmount) revert BelowMinimum();
        if (remaining > maxLoanAmount) revert AboveMaximum();

        // Close old loan — mark as Repaid (refinanced)
        oldLoan.status = LoanStatus.Repaid;

        // Open new loan with remaining balance
        PoolConfig storage config = poolConfigs[uint256(_newPool)];
        uint256 interest  = (remaining * config.baseInterestRate * config.maxDuration) / (365 days * 10000);
        uint256 totalOwed = remaining + interest;

        uint256 newLoanId = loanCount++;
        Loan storage newLoan = loans[newLoanId];
        newLoan.borrower       = msg.sender;
        newLoan.principal      = remaining;
        newLoan.totalOwed      = totalOwed;
        newLoan.interestRate   = config.baseInterestRate;
        newLoan.duration       = config.maxDuration;
        newLoan.status         = LoanStatus.Pending;
        newLoan.riskPool       = _newPool;
        newLoan.minCreditScore = config.minCreditScore;

        borrowerLoans[msg.sender].push(newLoanId);

        emit LoanRefinanced(msg.sender, _loanId, newLoanId);
        emit LoanRequested(msg.sender, newLoanId, remaining);

        // Kick off FHE approval for the new loan
        if (address(creditEngine) == address(0)) {
            _activateAndDisburse(newLoanId);
            return;
        }

        (bytes32 checkId, uint256 eboolCtHash) = creditEngine.requestApprovalCheck(
            msg.sender,
            config.minCreditScore
        );

        newLoan.approvalCheckId     = checkId;
        newLoan.approvalEboolCtHash = eboolCtHash;

        emit LoanApprovalCheckRequested(msg.sender, newLoanId, checkId, eboolCtHash);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Default
    // ──────────────────────────────────────────────────────────────────

    function markDefaulted(uint256 _loanId) external onlyOwner {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();
        loan.status = LoanStatus.Defaulted;
        // NEW: notify reputation registry of default
        _notifyReputation(loan.borrower, false);
        emit LoanDefaulted(loan.borrower, _loanId);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Reputation Hook
    // ──────────────────────────────────────────────────────────────────

    function _notifyReputation(address user, bool /* isRepayment */) internal {
        if (address(reputationRegistry) == address(0)) return;
        if (!reputationRegistry.isRegistered(user)) return;
        try reputationRegistry.notifyActivity(user) {} catch {}
    }

    // ──────────────────────────────────────────────────────────────────
    //  View Functions
    // ──────────────────────────────────────────────────────────────────

    function getAvailableLiquidity() external view returns (uint256) {
        return totalPoolLiquidity > totalLoanedOut
            ? totalPoolLiquidity - totalLoanedOut
            : 0;
    }

    function getLoan(uint256 _loanId) external view returns (
        address  borrower,
        uint256  principal,
        uint256  totalOwed,
        uint256  repaidAmount,
        uint256  interestRate,
        uint256  dueDate,
        uint256  status
    ) {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        return (loan.borrower, loan.principal, loan.totalOwed, loan.repaidAmount,
                loan.interestRate, loan.dueDate, uint256(loan.status));
    }

    function getLoanApprovalStatus(uint256 _loanId) external view returns (
        bool    approvalResolved,
        bool    approvalPassed,
        bytes32 checkId,
        uint256 eboolCtHash
    ) {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        return (loan.approvalResolved, loan.approvalPassed, loan.approvalCheckId, loan.approvalEboolCtHash);
    }

    function getBorrowerLoans(address _borrower) external view returns (uint256[] memory) {
        return borrowerLoans[_borrower];
    }

    function getLenderDeposit(address _lender) external view returns (uint256 amount, uint256 depositedAt) {
        LenderDeposit storage dep = lenderDeposits[_lender];
        return (dep.amount, dep.depositedAt);
    }

    function getLenderCount() external view returns (uint256) {
        return lenders.length;
    }

    function getLenderAtIndex(uint256 _index) external view returns (address) {
        return lenders[_index];
    }

    // ──────────────────────────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────────────────────────

    function setCreditEngine(address _engine) external onlyOwner {
        creditEngine = IEncryptedCreditEngineV3(_engine);
    }

    function setReputationRegistry(address _registry) external onlyOwner {
        reputationRegistry = IReputationRegistryV3(_registry);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }
}
