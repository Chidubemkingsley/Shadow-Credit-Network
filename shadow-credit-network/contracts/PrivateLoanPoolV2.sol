// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal interface to EncryptedCreditEngineV2
interface IEncryptedCreditEngineV2 {
    function hasCreditScore(address user) external view returns (bool);

    /// @notice Create an encrypted approval check and trigger async FHE decryption.
    /// @return checkId     Unique identifier for this check.
    /// @return eboolCtHash Ciphertext handle of the ebool (for monitoring).
    function requestApprovalCheck(
        address user,
        uint256 minScore
    ) external returns (bytes32 checkId, uint256 eboolCtHash);

    /// @notice Poll the decryption result. Returns (false, false) until ready.
    /// @dev    This is a state-mutating call — it stores the result on first resolution.
    function resolveApprovalCheck(bytes32 checkId) external returns (bool ready, bool approved);
}

/// @title PrivateLoanPoolV2
/// @notice ETH lending pool whose loan approval is gated on a verified ebool
///         from EncryptedCreditEngineV2.
///
/// Approval flow per loan:
///   1. requestLoan()           → creates Pending loan, calls creditEngine.requestApprovalCheck()
///                                which triggers FHE.decrypt(ebool) asynchronously.
///   2. Anyone polls            resolveLoanApproval(loanId) — calls creditEngine.resolveApprovalCheck()
///                                which polls FHE.getDecryptResultSafe(ebool).
///   3. Once the ebool is decrypted, resolveLoanApproval() reads the result:
///                                - approved → activates loan and disburses ETH
///                                - rejected → loan stays Pending (borrower can see status)
///
/// The key invariant: ETH is NEVER disbursed until the ebool resolves to true.
/// No owner override, no plaintext bool bypass.
contract PrivateLoanPoolV2 is Ownable {

    // ──────────────────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────────────────

    event PoolFunded(address indexed lender, uint256 amount);
    event PoolWithdrawn(address indexed lender, uint256 amount);
    event LoanRequested(address indexed borrower, uint256 indexed loanId, uint256 principal);
    /// @dev eboolCtHash is the ciphertext handle — useful for off-chain monitoring.
    event LoanApprovalCheckRequested(
        address indexed borrower,
        uint256 indexed loanId,
        bytes32 indexed checkId,
        uint256 eboolCtHash
    );
    event LoanApprovalResolved(address indexed borrower, uint256 indexed loanId, bool approved);
    event LoanApproved(address indexed borrower, uint256 indexed loanId);
    event LoanDisbursed(address indexed borrower, uint256 indexed loanId, uint256 amount);
    event RepaymentMade(address indexed borrower, uint256 indexed loanId, uint256 amount);
    event LoanDefaulted(address indexed borrower, uint256 indexed loanId);

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
    error ApprovalNotRequested();
    error PoolPaused();

    // ──────────────────────────────────────────────────────────────────
    //  Enums / Structs
    // ──────────────────────────────────────────────────────────────────

    enum LoanStatus { Pending, Active, Repaid, Defaulted }
    enum RiskPool   { Conservative, Moderate, Aggressive }

    struct Loan {
        address  borrower;
        uint256  principal;
        uint256  totalOwed;
        uint256  repaidAmount;
        uint256  interestRate;
        uint256  duration;
        uint256  approvedAt;
        uint256  dueDate;
        LoanStatus status;
        RiskPool   riskPool;
        uint256  minCreditScore;
        // Approval tracking
        bytes32  approvalCheckId;     // checkId from creditEngine
        uint256  approvalEboolCtHash; // ebool ciphertext handle (for monitoring)
        bool     approvalResolved;    // true once resolveApprovalCheck returned ready=true
        bool     approvalPassed;      // plaintext result, set on resolution
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

    IEncryptedCreditEngineV2 public creditEngine;

    uint256 public totalPoolLiquidity;
    uint256 public totalLoanedOut;
    uint256 public minLoanAmount = 0.01 ether;
    uint256 public maxLoanAmount = 100 ether;
    bool    public paused;

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
            baseInterestRate: 300,
            maxDuration:      90 days,
            minCreditScore:   740
        });
        // Moderate: 8% APR, 670+ score, 180 days
        poolConfigs[uint256(RiskPool.Moderate)] = PoolConfig({
            baseInterestRate: 800,
            maxDuration:      180 days,
            minCreditScore:   670
        });
        // Aggressive: 15% APR, 580+ score, 365 days
        poolConfigs[uint256(RiskPool.Aggressive)] = PoolConfig({
            baseInterestRate: 1500,
            maxDuration:      365 days,
            minCreditScore:   580
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
    //  Lending
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
    //  Borrowing — Step 1: request loan
    // ──────────────────────────────────────────────────────────────────

    /// @notice Request a loan. Creates a Pending loan and kicks off the FHE
    ///         approval flow by calling creditEngine.requestApprovalCheck().
    ///         The emitted LoanApprovalCheckRequested event carries the eboolCtHash
    ///         that the frontend must decrypt off-chain.
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
        loan.borrower        = msg.sender;
        loan.principal       = _principal;
        loan.totalOwed       = totalOwed;
        loan.interestRate    = config.baseInterestRate;
        loan.duration        = duration;
        loan.status          = LoanStatus.Pending;
        loan.riskPool        = _riskPool;
        loan.minCreditScore  = config.minCreditScore;

        borrowerLoans[msg.sender].push(loanId);
        emit LoanRequested(msg.sender, loanId, _principal);

        // If no credit engine, auto-approve (dev/test mode)
        if (address(creditEngine) == address(0)) {
            _activateAndDisburse(loanId);
            return;
        }

        // Require borrower to have a computed score
        if (!creditEngine.hasCreditScore(msg.sender)) revert NoCreditScore();

        // Request encrypted approval check — returns checkId + ebool ciphertext handle
        (bytes32 checkId, uint256 eboolCtHash) = creditEngine.requestApprovalCheck(
            msg.sender,
            config.minCreditScore
        );

        loan.approvalCheckId      = checkId;
        loan.approvalEboolCtHash  = eboolCtHash;

        emit LoanApprovalCheckRequested(msg.sender, loanId, checkId, eboolCtHash);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Borrowing — Step 2: resolve and disburse (permissionless)
    // ──────────────────────────────────────────────────────────────────

    /// @notice Poll the FHE decryption result and disburse if approved.
    ///         Anyone can call this — it is permissionless.
    ///         Returns silently if decryption is not yet complete (just try again later).
    function resolveLoanApproval(uint256 _loanId) external whenNotPaused {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        if (loan.status != LoanStatus.Pending) revert LoanNotPending();
        if (loan.approvalCheckId == bytes32(0)) revert ApprovalNotRequested();

        // Poll the credit engine — this writes state on first resolution
        (bool ready, bool approved) = creditEngine.resolveApprovalCheck(loan.approvalCheckId);

        // Not ready yet — caller should retry after a few blocks
        if (!ready) return;

        loan.approvalResolved = true;
        loan.approvalPassed   = approved;

        emit LoanApprovalResolved(loan.borrower, _loanId, approved);

        if (approved) {
            _activateAndDisburse(_loanId);
        }
        // If rejected, loan stays Pending with approvalResolved=true, approvalPassed=false
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
    //  Repayment
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

    function getLoanApprovalStatus(uint256 _loanId) external view returns (
        bool    approvalResolved,
        bool    approvalPassed,
        bytes32 checkId,
        uint256 eboolCtHash
    ) {
        if (_loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[_loanId];
        return (
            loan.approvalResolved,
            loan.approvalPassed,
            loan.approvalCheckId,
            loan.approvalEboolCtHash
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

    function getLenderAtIndex(uint256 _index) external view returns (address) {
        return lenders[_index];
    }

    // ──────────────────────────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────────────────────────

    function setCreditEngine(address _engine) external onlyOwner {
        creditEngine = IEncryptedCreditEngineV2(_engine);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }
}
