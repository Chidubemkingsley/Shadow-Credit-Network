// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ICreditEngine.sol";

contract PrivateLoanPool is Ownable {

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event PoolFunded(address indexed lender, uint256 amount);
    event PoolWithdrawn(address indexed lender, uint256 amount);
    event LoanRequested(address indexed borrower, uint256 loanId);
    event LoanApproved(address indexed borrower, uint256 loanId);
    event CreditVerified(address indexed borrower, uint256 loanId, bool passed);
    event RepaymentMade(address indexed borrower, uint256 loanId, uint256 amount);
    event LoanDefaulted(address indexed borrower, uint256 loanId);
    event CreditEngineSet(address indexed engine);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error InsufficientPoolLiquidity();
    error NotBorrower();
    error NotLender();
    error LoanNotFound();
    error LoanNotActive();
    error PoolPaused();
    error WithdrawalExceedsDeposit();
    error ZeroAmount();
    error BelowMinimumLoan();
    error ExceedsMaximumLoan();

    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    enum LoanStatus {
        Pending,
        Active,
        Repaid,
        Defaulted
    }

    enum RiskPool {
        Conservative,
        Moderate,
        Aggressive
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct Loan {
        address borrower;
        uint256 principal;
        uint256 duration;
        uint256 interestRate;
        uint256 repaidAmount;
        uint256 totalOwed;
        uint256 approvedAt;
        uint256 dueDate;
        LoanStatus status;
        RiskPool riskPool;
        bool creditVerified;
        bool creditPassed;
        bytes encryptedData; // Store encrypted inputs for verification (future use)
    }

    struct LenderDeposit {
        uint256 amount;
        uint256 depositedAt;
    }

    struct PoolConfig {
        uint256 maxLoanToDeposit;
        uint256 baseInterestRate;
        uint256 maxDuration;
        uint256 minCreditScore;
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    ICreditEngine public creditEngine;
    uint256 public totalPoolLiquidity;
    uint256 public totalLoanedOut;

    mapping(address => LenderDeposit) private lenderDeposits;
    address[] private lenders;
    mapping(address => bool) private isLender;

    mapping(uint256 => Loan) private loans;
    mapping(address => uint256[]) private borrowerLoans;
    uint256 public loanCount;

    mapping(uint256 => PoolConfig) private poolConfigs;
    bool public paused;
    uint256 public minLoanAmount;
    uint256 public maxLoanAmount;

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(address _owner) Ownable(_owner) {
        require(_owner != address(0), "Invalid owner");
        
        minLoanAmount = 0.01 ether;
        maxLoanAmount = 100 ether;

        poolConfigs[uint256(RiskPool.Conservative)] = PoolConfig({
            maxLoanToDeposit: 3000,
            baseInterestRate: 300,
            maxDuration: 90 days,
            minCreditScore: 740
        });

        poolConfigs[uint256(RiskPool.Moderate)] = PoolConfig({
            maxLoanToDeposit: 5000,
            baseInterestRate: 800,
            maxDuration: 180 days,
            minCreditScore: 670
        });

        poolConfigs[uint256(RiskPool.Aggressive)] = PoolConfig({
            maxLoanToDeposit: 7500,
            baseInterestRate: 1500,
            maxDuration: 365 days,
            minCreditScore: 580
        });
    }

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }

    // ──────────────────────────────────────────────
    //  Pool Funding (Lenders)
    // ──────────────────────────────────────────────

    function fundPool() external payable whenNotPaused {
        if (msg.value < minLoanAmount) revert BelowMinimumLoan();

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
        if (lenderDeposits[msg.sender].amount == 0) revert NotLender();
        if (_amount > lenderDeposits[msg.sender].amount) revert WithdrawalExceedsDeposit();

        lenderDeposits[msg.sender].amount -= _amount;
        totalPoolLiquidity -= _amount;

        (bool sent, ) = payable(msg.sender).call{value: _amount}("");
        require(sent, "ETH transfer failed");

        emit PoolWithdrawn(msg.sender, _amount);
    }

    // ──────────────────────────────────────────────
    //  Loan Requests (Borrowers)
    // ──────────────────────────────────────────────

    function requestLoan(
        uint256 _principal,
        uint256 _duration,
        RiskPool _riskPool
    ) external whenNotPaused {
        if (_principal < minLoanAmount) revert BelowMinimumLoan();
        if (_principal > maxLoanAmount) revert ExceedsMaximumLoan();

        uint256 available = totalPoolLiquidity > totalLoanedOut ? totalPoolLiquidity - totalLoanedOut : 0;
        if (_principal > available) revert InsufficientPoolLiquidity();

        PoolConfig storage config = poolConfigs[uint256(_riskPool)];
        
        uint256 duration = _duration > 0 ? _duration : config.maxDuration;
        uint256 interestComponent = (_principal * config.baseInterestRate * duration) / (365 days * 10000);
        uint256 totalOwed = _principal + interestComponent;

        uint256 loanId = loanCount++;

        loans[loanId] = Loan({
            borrower: msg.sender,
            principal: _principal,
            duration: duration,
            interestRate: config.baseInterestRate,
            repaidAmount: 0,
            totalOwed: totalOwed,
            approvedAt: 0,
            dueDate: 0,
            status: LoanStatus.Pending,
            riskPool: _riskPool,
            creditVerified: false,
            creditPassed: false,
            encryptedData: ""
        });

        borrowerLoans[msg.sender].push(loanId);
        totalLoanedOut += _principal;

        emit LoanRequested(msg.sender, loanId);

        _autoApproveIfQualified(loanId);
    }

    function _autoApproveIfQualified(uint256 _loanId) internal {
        Loan storage loan = loans[_loanId];

        if (address(creditEngine) == address(0)) {
            loan.status = LoanStatus.Active;
            loan.approvedAt = block.timestamp;
            loan.dueDate = block.timestamp + loans[_loanId].duration * 1 days;
            _disburseLoan(_loanId);
            emit LoanApproved(loan.borrower, _loanId);
            return;
        }

        if (!creditEngine.hasComputedScore(loan.borrower)) {
            return;
        }

        PoolConfig storage config = poolConfigs[uint256(loan.riskPool)];

        bool passed = creditEngine.checkCreditThreshold(loan.borrower, config.minCreditScore);

        loan.creditVerified = true;
        loan.creditPassed = passed;
        emit CreditVerified(loan.borrower, _loanId, passed);

        if (passed) {
            loan.status = LoanStatus.Active;
            loan.approvedAt = block.timestamp;
            loan.dueDate = block.timestamp + loan.duration * 1 days;
            _disburseLoan(_loanId);
            emit LoanApproved(loan.borrower, _loanId);
        }
    }

    function _disburseLoan(uint256 _loanId) internal {
        Loan storage loan = loans[_loanId];
        require(loan.status == LoanStatus.Active, "Loan not active");
        require(address(this).balance >= loan.principal, "Insufficient pool balance");
        
        (bool sent, ) = payable(loan.borrower).call{value: loan.principal}("");
        require(sent, "ETH disbursement failed");
    }

    // ──────────────────────────────────────────────
    //  Repayment
    // ──────────────────────────────────────────────

    function repayLoan(uint256 _loanId) external payable whenNotPaused {
        if (_loanId >= loanCount) revert LoanNotFound();
        if (msg.value == 0) revert ZeroAmount();
        
        Loan storage loan = loans[_loanId];
        
        if (loan.borrower != msg.sender) revert NotBorrower();
        if (loan.status != LoanStatus.Active) revert LoanNotActive();

        loan.repaidAmount += msg.value;
        totalLoanedOut -= msg.value;
        totalPoolLiquidity += msg.value;

        if (loan.repaidAmount >= loan.totalOwed) {
            loan.status = LoanStatus.Repaid;
        }

        emit RepaymentMade(msg.sender, _loanId, msg.value);
    }

    // ──────────────────────────────────────────────
    //  Default & Liquidation
    // ──────────────────────────────────────────────

    function markDefaulted(uint256 _loanId) external onlyOwner {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();

        loan.status = LoanStatus.Defaulted;
        emit LoanDefaulted(loan.borrower, _loanId);
    }

    // ──────────────────────────────────────────────
    //  Read-Only Queries
    // ──────────────────────────────────────────────

    function getLoan(uint256 _loanId) external view returns (
        address borrower,
        uint256 principal,
        uint256 interestRate,
        uint256 repaidAmount,
        uint256 totalOwed,
        uint256 status,
        uint256 dueDate,
        bool creditVerified,
        bool creditPassed
    ) {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        return (
            loan.borrower,
            loan.principal,
            loan.interestRate,
            loan.repaidAmount,
            loan.totalOwed,
            uint256(loan.status),
            loan.dueDate,
            loan.creditVerified,
            loan.creditPassed
        );
    }

    function getLoanStatus(uint256 _loanId) external view returns (uint256) {
        if (_loanId >= loanCount) revert LoanNotFound();
        return uint256(loans[_loanId].status);
    }

    function getBorrowerLoans(address _borrower) external view returns (uint256[] memory) {
        return borrowerLoans[_borrower];
    }

    function getLenderDeposit(address _lender) external view returns (uint256 amount, uint256 depositedAt) {
        return (lenderDeposits[_lender].amount, lenderDeposits[_lender].depositedAt);
    }

    function getAvailableLiquidity() external view returns (uint256) {
        return totalPoolLiquidity > totalLoanedOut ? totalPoolLiquidity - totalLoanedOut : 0;
    }

    function getLenderCount() external view returns (uint256) {
        return lenders.length;
    }

    function getLenderAtIndex(uint256 _index) external view returns (address) {
        return lenders[_index];
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    function setCreditEngine(ICreditEngine _engine) external onlyOwner {
        creditEngine = _engine;
        emit CreditEngineSet(address(_engine));
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }
}
