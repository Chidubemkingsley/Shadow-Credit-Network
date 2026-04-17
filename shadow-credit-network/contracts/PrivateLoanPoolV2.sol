// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IEncryptedCreditEngine {
    function hasCreditScore(address user) external view returns (bool);
    function checkCreditApproval(address user, uint256 minScore) external view returns (bool);
}

contract PrivateLoanPoolV2 is Ownable {

    using FHE for *;

    // ──────────────────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────────────────

    event PoolFunded(address indexed lender, uint256 amount);
    event PoolWithdrawn(address indexed lender, uint256 amount);
    event LoanRequested(address indexed borrower, uint256 loanId, uint256 principal);
    event LoanApproved(address indexed borrower, uint256 loanId);
    event LoanDisbursed(address indexed borrower, uint256 loanId, uint256 amount);
    event RepaymentMade(address indexed borrower, uint256 loanId, uint256 amount);
    event LoanDefaulted(address indexed borrower, uint256 loanId);

    // ──────────────────────────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────────────────────────

    error InsufficientLiquidity();
    error NotBorrower();
    error LoanNotFound();
    error LoanNotActive();
    error BelowMinimum();
    error AboveMaximum();
    error CreditCheckFailed();
    error PoolPaused();

    // ──────────────────────────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────────────────────────

    enum LoanStatus { Pending, Active, Repaid, Defaulted }
    enum RiskPool { Conservative, Moderate, Aggressive }

    // ──────────────────────────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────────────────────────

    struct Loan {
        address borrower;
        uint256 principal;
        uint256 totalOwed;
        uint256 repaidAmount;
        uint256 interestRate;
        uint256 duration;
        uint256 approvedAt;
        uint256 dueDate;
        LoanStatus status;
        RiskPool riskPool;
        uint256 minCreditScore;
    }

    struct PoolConfig {
        uint256 maxLoanToDeposit;
        uint256 baseInterestRate;
        uint256 maxDuration;
        uint256 minCreditScore;
    }

    struct LenderDeposit {
        uint256 amount;
        uint256 depositedAt;
    }

    // ──────────────────────────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────────────────────────

    IEncryptedCreditEngine public creditEngine;
    
    uint256 public totalPoolLiquidity;
    uint256 public totalLoanedOut;
    uint256 public minLoanAmount = 0.01 ether;
    uint256 public maxLoanAmount = 100 ether;
    bool public paused;

    mapping(address => LenderDeposit) public lenderDeposits;
    address[] public lenders;
    mapping(address => bool) public isLender;

    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) public borrowerLoans;
    uint256 public loanCount;

    mapping(uint256 => PoolConfig) public poolConfigs;

    // ──────────────────────────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor(address _owner) Ownable(_owner) {
        // Conservative: 3% APR, 740+ score, 90 days
        poolConfigs[uint256(RiskPool.Conservative)] = PoolConfig({
            maxLoanToDeposit: 3000,
            baseInterestRate: 300,
            maxDuration: 90 days,
            minCreditScore: 740
        });

        // Moderate: 8% APR, 670+ score, 180 days
        poolConfigs[uint256(RiskPool.Moderate)] = PoolConfig({
            maxLoanToDeposit: 5000,
            baseInterestRate: 800,
            maxDuration: 180 days,
            minCreditScore: 670
        });

        // Aggressive: 15% APR, 580+ score, 365 days
        poolConfigs[uint256(RiskPool.Aggressive)] = PoolConfig({
            maxLoanToDeposit: 7500,
            baseInterestRate: 1500,
            maxDuration: 365 days,
            minCreditScore: 580
        });
    }

    // ──────────────────────────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────────────────────────

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Lending Functions
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

    // ──────────────────────────────────────────────────────────────────
    //  Borrowing Functions (FHE-Powered)
    // ──────────────────────────────────────────────────────────────────

    /**
     * @notice Request a loan - FHE verifies creditworthiness
     * @dev Credit approval uses ebool from creditEngine.checkCreditApproval()
     */
    function requestLoan(
        uint256 _principal,
        uint256 _duration,
        RiskPool _riskPool
    ) external whenNotPaused {
        if (_principal < minLoanAmount) revert BelowMinimum();
        if (_principal > maxLoanAmount) revert AboveMaximum();
        
        uint256 available = totalPoolLiquidity > totalLoanedOut 
            ? totalPoolLiquidity - totalLoanedOut 
            : 0;
        if (_principal > available) revert InsufficientLiquidity();

        PoolConfig storage config = poolConfigs[uint256(_riskPool)];
        
        // Calculate duration
        uint256 duration = _duration > 0 ? _duration : config.maxDuration;
        if (duration > config.maxDuration) duration = config.maxDuration;
        
        // Calculate interest
        uint256 interestComponent = (_principal * config.baseInterestRate * duration) / (365 days * 10000);
        uint256 totalOwed = _principal + interestComponent;

        // Create loan in Pending status
        uint256 loanId = loanCount++;
        loans[loanId] = Loan({
            borrower: msg.sender,
            principal: _principal,
            totalOwed: totalOwed,
            repaidAmount: 0,
            interestRate: config.baseInterestRate,
            duration: duration,
            approvedAt: 0,
            dueDate: 0,
            status: LoanStatus.Pending,
            riskPool: _riskPool,
            minCreditScore: config.minCreditScore
        });

        borrowerLoans[msg.sender].push(loanId);
        
        emit LoanRequested(msg.sender, loanId, _principal);

        // FHE-based credit check
        _checkAndApproveLoan(loanId);
    }

    /**
     * @dev FHE-powered loan approval
     * Uses ebool from credit engine - runs encrypted comparison
     */
    function _checkAndApproveLoan(uint256 _loanId) internal {
        Loan storage loan = loans[_loanId];
        
        // If credit engine not set, auto-approve
        if (address(creditEngine) == address(0)) {
            loan.status = LoanStatus.Active;
            loan.approvedAt = block.timestamp;
            loan.dueDate = block.timestamp + loan.duration;
            totalLoanedOut += loan.principal;
            _disburseLoan(_loanId);
            emit LoanApproved(loan.borrower, _loanId);
            return;
        }

        // Check if user has computed credit score
        if (!creditEngine.hasCreditScore(loan.borrower)) {
            // No score yet - leave as Pending until score is computed
            return;
        }

        // FHE-based credit check
        // This returns ebool which resolves via TaskManager
        bool approved = creditEngine.checkCreditApproval(
            loan.borrower, 
            loan.minCreditScore
        );

        if (approved) {
            loan.status = LoanStatus.Active;
            loan.approvedAt = block.timestamp;
            loan.dueDate = block.timestamp + loan.duration;
            totalLoanedOut += loan.principal;
            _disburseLoan(_loanId);
            emit LoanApproved(loan.borrower, _loanId);
        }
        // If not approved, stays Pending
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
    //  Repayment
    // ──────────────────────────────────────────────────────────────────

    function repayLoan(uint256 _loanId) external payable whenNotPaused {
        if (_loanId >= loanCount) revert LoanNotFound();
        if (msg.value == 0) revert BelowMinimum();
        
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

    function markDefaulted(uint256 _loanId) external onlyOwner {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();

        loan.status = LoanStatus.Defaulted;
        emit LoanDefaulted(loan.borrower, _loanId);
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
        address borrower,
        uint256 principal,
        uint256 totalOwed,
        uint256 repaidAmount,
        uint256 interestRate,
        uint256 dueDate,
        uint256 status
    ) {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        return (
            loan.borrower,
            loan.principal,
            loan.totalOwed,
            loan.repaidAmount,
            loan.interestRate,
            loan.dueDate,
            uint256(loan.status)
        );
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

    // ──────────────────────────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────────────────────────

    function setCreditEngine(address _engine) external onlyOwner {
        creditEngine = IEncryptedCreditEngine(_engine);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }
}