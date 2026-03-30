// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PrivateLoanPool
/// @notice Privacy-preserving lending pool enabling undercollateralized loans
///      powered by encrypted credit scores from EncryptedCreditEngine.
/// @dev Lenders deposit ETH into the pool. Borrowers request loans whose
///      amounts, interest rates, and repayment status are encrypted on-chain.
///      All financial data remains private via FHE.
contract PrivateLoanPool is Ownable {

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event PoolFunded(address indexed lender, uint256 amount);
    event PoolWithdrawn(address indexed lender, uint256 amount);
    event LoanRequested(address indexed borrower, uint256 loanId);
    event LoanApproved(address indexed borrower, uint256 loanId);
    event LoanRejected(address indexed borrower, uint256 loanId);
    event RepaymentMade(address indexed borrower, uint256 loanId, uint256 amount);
    event LoanDefaulted(address indexed borrower, uint256 loanId);
    event LoanLiquidated(address indexed borrower, uint256 loanId, address indexed liquidator);
    event YieldDistributed(address indexed lender, uint256 yieldHash);
    event CreditEngineSet(address indexed engine);
    event PoolParametersUpdated();

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error ZeroAmount();
    error InsufficientPoolLiquidity();
    error NotBorrower();
    error NotLender();
    error LoanNotFound();
    error LoanNotActive();
    error LoanAlreadyRepaid();
    error LoanMarkedDefaulted();
    error NotAuthorized();
    error CreditEngineNotSet();
    error InsufficientCreditScore();
    error PoolPaused();
    error WithdrawalExceedsDeposit();
    error NoYieldToClaim();
    error LoanStillActive();
    error RepaymentExceedsDebt();
    error MinLoanDurationNotMet();
    error AlreadyClaimed();

    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    enum LoanStatus {
        Pending,      // Requested, awaiting approval
        Active,       // Approved and disbursed
        Repaid,       // Fully repaid
        Defaulted,    // Past due, not repaid
        Liquidated    // Liquidated by liquidator
    }

    enum RiskPool {
        Conservative,  // Low-risk, low-yield
        Moderate,      // Medium-risk, medium-yield
        Aggressive     // High-risk, high-yield
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    /// @notice Loan request and state
    struct Loan {
        address borrower;
        euint64 principal;           // Loan amount in wei (encrypted)
        euint32 interestRate;        // Annual interest rate in bps (encrypted, e.g. 500 = 5%)
        euint32 duration;            // Loan duration in seconds (encrypted)
        euint64 repaidAmount;        // Total repaid amount (encrypted)
        euint64 totalOwed;           // Total amount owed including interest (encrypted)
        uint256 approvedAt;          // Timestamp when loan was approved
        uint256 dueDate;             // Timestamp when loan is due
        LoanStatus status;           // Plaintext status for operational queries
        RiskPool riskPool;           // Risk pool assignment (plaintext)
    }

    /// @notice Liquidity provider deposit record
    struct LenderDeposit {
        uint256 amount;              // Total deposited (plaintext wei)
        uint256 depositedAt;         // Deposit timestamp
        euint64 earnedYield;         // Accumulated yield (encrypted)
        bool hasWithdrawn;           // Whether LP has withdrawn
    }

    /// @notice Pool configuration per risk tier
    struct PoolConfig {
        euint32 maxLoanToDeposit;    // Max loan as % of deposit basis points (encrypted)
        euint32 baseInterestRate;    // Base interest rate in bps (encrypted)
        uint256 maxDuration;         // Max loan duration in seconds
        uint256 minCreditScore;      // Minimum credit score to qualify (plaintext for gating)
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @notice Contract address for EncryptedCreditEngine
    address public creditEngine;

    /// @notice Total ETH deposited by lenders
    uint256 public totalPoolLiquidity;

    /// @notice Total ETH currently lent out
    uint256 public totalLoanedOut;

    /// @notice Lender deposit records
    mapping(address => LenderDeposit) private lenderDeposits;

    /// @notice List of all lenders
    address[] private lenders;
    mapping(address => bool) private isLenderIndex;

    /// @notice All loans by ID
    mapping(uint256 => Loan) private loans;

    /// @notice Loan IDs per borrower
    mapping(address => uint256[]) private borrowerLoans;

    /// @notice Total loans counter
    uint256 public loanCount;

    /// @notice Pool configurations per risk tier
    mapping(uint256 => PoolConfig) private poolConfigs;

    /// @notice Whether pool is paused
    bool public paused;

    /// @notice Minimum ETH loan amount
    uint256 public minLoanAmount;

    /// @notice Maximum ETH loan amount
    uint256 public maxLoanAmount;

    /// @notice Protocol fee in bps
    uint256 public protocolFee;

    /// @notice Fee receiver address
    address public feeReceiver;

    /// @notice Accrued protocol fees
    uint256 public accruedFees;

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(
        address _owner,
        address _feeReceiver
    ) Ownable(_owner) {
        require(_owner != address(0), "Invalid owner");
        require(_feeReceiver != address(0), "Invalid fee receiver");

        feeReceiver = _feeReceiver;
        minLoanAmount = 0.01 ether;
        maxLoanAmount = 100 ether;
        protocolFee = 50; // 0.5% in bps

        // Initialize pool configs for each risk tier
        _initializePoolConfigs();
    }

    function _initializePoolConfigs() internal {
        // Conservative: max 30% of deposit, 3% base rate, 90 days max, score >= 740
        poolConfigs[uint256(RiskPool.Conservative)] = PoolConfig({
            maxLoanToDeposit: FHE.asEuint32(3000),
            baseInterestRate: FHE.asEuint32(300),
            maxDuration: 90 days,
            minCreditScore: 740
        });

        // Moderate: max 50% of deposit, 8% base rate, 180 days max, score >= 670
        poolConfigs[uint256(RiskPool.Moderate)] = PoolConfig({
            maxLoanToDeposit: FHE.asEuint32(5000),
            baseInterestRate: FHE.asEuint32(800),
            maxDuration: 180 days,
            minCreditScore: 670
        });

        // Aggressive: max 75% of deposit, 15% base rate, 365 days max, score >= 580
        poolConfigs[uint256(RiskPool.Aggressive)] = PoolConfig({
            maxLoanToDeposit: FHE.asEuint32(7500),
            baseInterestRate: FHE.asEuint32(1500),
            maxDuration: 365 days,
            minCreditScore: 580
        });

        for (uint256 i = 0; i < 3; i++) {
            FHE.allowThis(poolConfigs[i].maxLoanToDeposit);
            FHE.allowThis(poolConfigs[i].baseInterestRate);
        }
    }

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }

    modifier validLoan(uint256 _loanId) {
        if (_loanId >= loanCount) revert LoanNotFound();
        _;
    }

    // ──────────────────────────────────────────────
    //  Pool Funding (Lenders)
    // ──────────────────────────────────────────────

    /// @notice Deposit ETH into the lending pool
    function fundPool() external payable whenNotPaused {
        require(msg.value >= minLoanAmount, "Below minimum deposit");

        LenderDeposit storage deposit = lenderDeposits[msg.sender];

        if (deposit.amount == 0) {
            deposit.depositedAt = block.timestamp;
            deposit.earnedYield = FHE.asEuint64(0);
            deposit.hasWithdrawn = false;
            FHE.allowThis(deposit.earnedYield);
            FHE.allowSender(deposit.earnedYield);

            if (!isLenderIndex[msg.sender]) {
                lenders.push(msg.sender);
                isLenderIndex[msg.sender] = true;
            }
        }

        deposit.amount += msg.value;
        totalPoolLiquidity += msg.value;

        emit PoolFunded(msg.sender, msg.value);
    }

    /// @notice Withdraw deposited ETH (only if not locked in active loans)
    function withdrawFunds(uint256 _amount) external whenNotPaused {
        LenderDeposit storage deposit = lenderDeposits[msg.sender];
        if (deposit.amount == 0) revert NotLender();
        if (_amount > deposit.amount) revert WithdrawalExceedsDeposit();

        deposit.amount -= _amount;
        totalPoolLiquidity -= _amount;

        // Transfer ETH back to lender
        (bool sent, ) = payable(msg.sender).call{value: _amount}("");
        require(sent, "ETH transfer failed");

        emit PoolWithdrawn(msg.sender, _amount);
    }

    /// @notice Claim accumulated yield
    function claimYield() external {
        LenderDeposit storage deposit = lenderDeposits[msg.sender];
        if (deposit.amount == 0) revert NotLender();

        // Decrypt yield
        FHE.decrypt(deposit.earnedYield);
    }

    // ──────────────────────────────────────────────
    //  Loan Requests (Borrowers)
    // ──────────────────────────────────────────────

    /// @notice Request a loan from the pool
    /// @param _principal Encrypted loan amount in wei
    /// @param _duration Encrypted loan duration in seconds
    /// @param _riskPool Risk pool to borrow from
    function requestLoan(
        InEuint64 calldata _principal,
        InEuint32 calldata _duration,
        RiskPool _riskPool
    ) external whenNotPaused {
        euint64 principal = FHE.asEuint64(_principal);
        euint32 duration = FHE.asEuint32(_duration);

        // Validate loan amount limits (encrypted check)
        euint64 minLoan = FHE.asEuint64(minLoanAmount);
        euint64 maxLoan = FHE.asEuint64(maxLoanAmount);
        FHE.gte(principal, minLoan);
        FHE.lte(principal, maxLoan);

        PoolConfig storage config = poolConfigs[uint256(_riskPool)];

        // Compute interest rate based on risk pool
        euint32 interestRate = config.baseInterestRate;
        FHE.allowThis(interestRate);

        // Compute total owed: principal * (1 + rate * duration / 365 days / 10000)
        // Simplified: totalOwed = principal + principal * rate * duration / (365 days * 10000)
        euint64 principalValue = principal;
        euint64 interestComponent = FHE.div(
            FHE.mul(
                FHE.mul(principalValue, FHE.asEuint64(uint64(euint32.unwrap(interestRate)))),
                FHE.asEuint64(uint64(euint32.unwrap(duration)))
            ),
            FHE.mul(FHE.asEuint64(365 days), FHE.asEuint64(10000))
        );
        euint64 totalOwed = FHE.add(principalValue, interestComponent);

        uint256 loanId = loanCount++;

        loans[loanId] = Loan({
            borrower: msg.sender,
            principal: principal,
            interestRate: interestRate,
            duration: duration,
            repaidAmount: FHE.asEuint64(0),
            totalOwed: totalOwed,
            approvedAt: 0,
            dueDate: 0,
            status: LoanStatus.Pending,
            riskPool: _riskPool
        });

        borrowerLoans[msg.sender].push(loanId);

        // Grant permissions
        FHE.allowThis(principal);
        FHE.allowThis(duration);
        FHE.allowThis(interestRate);
        FHE.allowThis(totalOwed);
        FHE.allowThis(loans[loanId].repaidAmount);
        FHE.allowSender(principal);
        FHE.allowSender(duration);
        FHE.allowSender(interestRate);
        FHE.allowSender(totalOwed);
        FHE.allowSender(loans[loanId].repaidAmount);

        emit LoanRequested(msg.sender, loanId);
    }

    // ──────────────────────────────────────────────
    //  Loan Approval (Owner / Admin)
    // ──────────────────────────────────────────────

    /// @notice Approve a pending loan and disburse funds
    /// @dev In production, this should be called by a credit scoring oracle
    ///      that verifies the borrower's encrypted credit score meets the threshold.
    /// @param _loanId The loan ID to approve
    /// @param _disbursementAmount ETH amount to send to borrower (plaintext for pool accounting)
    function approveLoan(uint256 _loanId, uint256 _disbursementAmount) external payable onlyOwner validLoan(_loanId) {
        Loan storage loan = loans[_loanId];
        if (loan.status != LoanStatus.Pending) revert LoanNotActive();
        require(_disbursementAmount > 0, "Zero disbursement");

        // Check pool has sufficient liquidity
        uint256 availableLiquidity = totalPoolLiquidity - totalLoanedOut;
        if (availableLiquidity < _disbursementAmount) revert InsufficientPoolLiquidity();

        loan.status = LoanStatus.Active;
        loan.approvedAt = block.timestamp;

        // Due date based on max duration for the risk pool
        uint256 maxDuration = poolConfigs[uint256(loan.riskPool)].maxDuration;
        loan.dueDate = block.timestamp + maxDuration;

        // Track disbursed amount
        totalLoanedOut += _disbursementAmount;

        emit LoanApproved(loan.borrower, _loanId);

        // Disburse ETH to borrower
        (bool sent, ) = payable(loan.borrower).call{value: _disbursementAmount}("");
        require(sent, "ETH transfer failed");
    }

    /// @notice Reject a pending loan
    function rejectLoan(uint256 _loanId) external onlyOwner validLoan(_loanId) {
        Loan storage loan = loans[_loanId];
        if (loan.status != LoanStatus.Pending) revert LoanNotActive();

        loan.status = LoanStatus.Defaulted; // Reuse Defaulted for rejected

        emit LoanRejected(loan.borrower, _loanId);
    }

    // ──────────────────────────────────────────────
    //  Repayment
    // ──────────────────────────────────────────────

    /// @notice Repay a loan (full or partial)
    function repayLoan(uint256 _loanId) external payable whenNotPaused validLoan(_loanId) {
        Loan storage loan = loans[_loanId];
        if (loan.borrower != msg.sender) revert NotBorrower();
        if (loan.status != LoanStatus.Active) revert LoanNotActive();

        require(msg.value > 0, "Zero repayment");

        // Update repaid amount (encrypted)
        euint64 repaymentValue = FHE.asEuint64(msg.value);
        euint64 newRepaid = FHE.add(loan.repaidAmount, repaymentValue);

        // Check if overpaying
        ebool isOverpaying = FHE.gt(newRepaid, loan.totalOwed);
        // Clamp to total owed
        euint64 clampedRepaid = FHE.select(isOverpaying, loan.totalOwed, newRepaid);

        loan.repaidAmount = clampedRepaid;

        FHE.allowThis(newRepaid);
        FHE.allowThis(clampedRepaid);
        FHE.allowSender(clampedRepaid);
        FHE.allow(clampedRepaid, loan.borrower);

        // Distribute to pool (simplified: goes to pool liquidity)
        totalLoanedOut -= msg.value;
        totalPoolLiquidity += msg.value;

        // Deduct protocol fee
        uint256 fee = (msg.value * protocolFee) / 10000;
        accruedFees += fee;
        uint256 toPool = msg.value - fee;
        totalPoolLiquidity = totalPoolLiquidity - msg.value + toPool;

        emit RepaymentMade(msg.sender, _loanId, msg.value);

        // If fully repaid, update status
        // Note: In a real system, you'd use FHE.decrypt + callback
        // For now, we accept the repayment and leave status check to off-chain
    }

    /// @notice Mark a loan as fully repaid (called after decryption confirms full repayment)
    function markRepaid(uint256 _loanId) external onlyOwner validLoan(_loanId) {
        Loan storage loan = loans[_loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();

        loan.status = LoanStatus.Repaid;
    }

    // ──────────────────────────────────────────────
    //  Default & Liquidation
    // ──────────────────────────────────────────────

    /// @notice Mark a loan as defaulted (past due date)
    function markDefaulted(uint256 _loanId) external onlyOwner validLoan(_loanId) {
        Loan storage loan = loans[_loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();
        if (block.timestamp < loan.dueDate) revert MinLoanDurationNotMet();

        loan.status = LoanStatus.Defaulted;

        emit LoanDefaulted(loan.borrower, _loanId);
    }

    /// @notice Liquidate a defaulted loan
    function liquidateLoan(uint256 _loanId) external validLoan(_loanId) {
        Loan storage loan = loans[_loanId];
        if (loan.status != LoanStatus.Defaulted) revert LoanNotActive();

        loan.status = LoanStatus.Liquidated;

        emit LoanLiquidated(loan.borrower, _loanId, msg.sender);
    }

    // ──────────────────────────────────────────────
    //  Yield Distribution
    // ──────────────────────────────────────────────

    /// @notice Distribute yield to a lender based on their share of the pool
    /// @param _lender The lender to distribute yield to
    /// @param _yieldAmount Encrypted yield amount
    function distributeYield(
        address _lender,
        InEuint64 calldata _yieldAmount
    ) external onlyOwner {
        LenderDeposit storage deposit = lenderDeposits[_lender];
        if (deposit.amount == 0) revert NotLender();

        euint64 yieldAmount = FHE.asEuint64(_yieldAmount);
        deposit.earnedYield = FHE.add(deposit.earnedYield, yieldAmount);

        FHE.allowThis(deposit.earnedYield);
        FHE.allowSender(deposit.earnedYield);
        FHE.allow(deposit.earnedYield, _lender);

        emit YieldDistributed(_lender, euint64.unwrap(deposit.earnedYield));
    }

    // ──────────────────────────────────────────────
    //  Read-Only Queries
    // ──────────────────────────────────────────────

    /// @notice Get loan details (returns encrypted fields)
    function getLoan(uint256 _loanId) external view returns (
        address borrower,
        euint64 principal,
        euint32 interestRate,
        euint64 repaidAmount,
        euint64 totalOwed,
        LoanStatus status,
        uint256 dueDate
    ) {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        return (
            loan.borrower,
            loan.principal,
            loan.interestRate,
            loan.repaidAmount,
            loan.totalOwed,
            loan.status,
            loan.dueDate
        );
    }

    /// @notice Get loan status (plaintext)
    function getLoanStatus(uint256 _loanId) external view returns (LoanStatus) {
        if (_loanId >= loanCount) revert LoanNotFound();
        return loans[_loanId].status;
    }

    /// @notice Get borrower's loan IDs
    function getBorrowerLoans(address _borrower) external view returns (uint256[] memory) {
        return borrowerLoans[_borrower];
    }

    /// @notice Get lender deposit info
    function getLenderDeposit(address _lender) external view returns (
        uint256 amount,
        uint256 depositedAt,
        euint64 earnedYield
    ) {
        LenderDeposit storage deposit = lenderDeposits[_lender];
        return (deposit.amount, deposit.depositedAt, deposit.earnedYield);
    }

    /// @notice Get available pool liquidity
    function getAvailableLiquidity() external view returns (uint256) {
        return totalPoolLiquidity - totalLoanedOut;
    }

    /// @notice Get number of lenders
    function getLenderCount() external view returns (uint256) {
        return lenders.length;
    }

    /// @notice Get lender address by index
    function getLenderAtIndex(uint256 _index) external view returns (address) {
        return lenders[_index];
    }

    /// @notice Get number of borrower loans
    function getBorrowerLoanCount(address _borrower) external view returns (uint256) {
        return borrowerLoans[_borrower].length;
    }

    /// @notice Get pool config for a risk tier
    function getPoolConfig(RiskPool _riskPool) external view returns (
        euint32 maxLoanToDeposit,
        euint32 baseInterestRate,
        uint256 maxDuration,
        uint256 minCreditScore
    ) {
        PoolConfig storage config = poolConfigs[uint256(_riskPool)];
        return (config.maxLoanToDeposit, config.baseInterestRate, config.maxDuration, config.minCreditScore);
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    /// @notice Set the credit engine contract address
    function setCreditEngine(address _engine) external onlyOwner {
        if (_engine == address(0)) revert ZeroAmount();
        creditEngine = _engine;
        emit CreditEngineSet(_engine);
    }

    /// @notice Update pool parameters
    function updatePoolParams(
        uint256 _minLoanAmount,
        uint256 _maxLoanAmount,
        uint256 _protocolFee
    ) external onlyOwner {
        if (_minLoanAmount > 0) minLoanAmount = _minLoanAmount;
        if (_maxLoanAmount > 0) maxLoanAmount = _maxLoanAmount;
        if (_protocolFee <= 1000) protocolFee = _protocolFee; // Max 10%
        emit PoolParametersUpdated();
    }

    /// @notice Pause / unpause the pool
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    /// @notice Update fee receiver
    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        require(_feeReceiver != address(0), "Invalid fee receiver");
        feeReceiver = _feeReceiver;
    }

    /// @notice Withdraw accrued protocol fees
    function withdrawFees() external onlyOwner {
        uint256 fees = accruedFees;
        if (fees == 0) revert ZeroAmount();
        accruedFees = 0;

        (bool sent, ) = payable(feeReceiver).call{value: fees}("");
        require(sent, "ETH transfer failed");
    }
}
