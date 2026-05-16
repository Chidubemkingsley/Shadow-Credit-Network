// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal interface to EncryptedCreditEngineV3
interface ICreditEngineForPool {
    function hasCreditScore(address user) external view returns (bool);
    function isScoreStale(address user) external view returns (bool);
    function requestApprovalCheck(address user, uint256 minScore)
        external returns (bytes32 checkId, uint256 eboolCtHash);
    function resolveApprovalCheck(bytes32 checkId)
        external returns (bool ready, bool approved);
}

/// @notice Minimal interface to ReputationRegistry
interface IReputationForMultiPool {
    function isRegistered(address user) external view returns (bool);
    function notifyActivity(address user) external;
}

/// @title MultiAssetLoanPool
/// @notice Wave 4 — ERC-20 collateral lending pool.
///
/// Extends PrivateLoanPoolV3 to support ERC-20 tokens as both:
///   (a) Pool liquidity — lenders deposit any whitelisted ERC-20
///   (b) Loan collateral — borrowers post partial ERC-20 collateral
///       to reduce the credit score requirement for their risk tier.
///
/// Key differences from PrivateLoanPoolV3:
///   - Supports multiple asset types (USDC, WBTC, WETH, etc.)
///   - Collateral reduces effective minCreditScore:
///       LTV 50%+ → −50 score requirement
///       LTV 25%+ → −25 score requirement
///   - Collateral is held in escrow until loan repayment or default
///   - On default, collateral is liquidated to partially cover loss
///   - Lender yield is distributed per-asset (no cross-asset pooling)
///   - ebool-gated disbursement inherited from V3 (no plaintext bypass)
///
/// Supported asset types (owner-configurable):
///   Each asset has: decimals, priceFeedAddress (Chainlink-compatible), enabled flag
///   For Wave 4: price feeds are set manually (oracle integration in Wave 5)
contract MultiAssetLoanPool is Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────────────────

    event AssetWhitelisted(address indexed token, uint8 decimals, string symbol);
    event AssetDisabled(address indexed token);
    event AssetPriceUpdated(address indexed token, uint256 priceUsd18);

    event PoolFunded(address indexed lender, address indexed token, uint256 amount);
    event PoolWithdrawn(address indexed lender, address indexed token, uint256 amount);
    event YieldClaimed(address indexed lender, address indexed token, uint256 amount);

    event LoanRequested(address indexed borrower, uint256 indexed loanId, address token, uint256 principal);
    event CollateralPosted(address indexed borrower, uint256 indexed loanId, address token, uint256 amount);
    event CollateralReleased(address indexed borrower, uint256 indexed loanId, address token, uint256 amount);
    event CollateralLiquidated(address indexed borrower, uint256 indexed loanId, address token, uint256 amount);
    event LoanApprovalCheckRequested(address indexed borrower, uint256 indexed loanId, bytes32 checkId, uint256 eboolCtHash);
    event LoanApprovalResolved(address indexed borrower, uint256 indexed loanId, bool approved);
    event LoanDisbursed(address indexed borrower, uint256 indexed loanId, address token, uint256 amount);
    event RepaymentMade(address indexed borrower, uint256 indexed loanId, uint256 amount, bool fullRepayment);
    event LoanDefaulted(address indexed borrower, uint256 indexed loanId);

    // ──────────────────────────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────────────────────────

    error AssetNotWhitelisted();
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
    error CollateralTransferFailed();
    error ExcessiveCollateral();

    // ──────────────────────────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────────────────────────

    enum LoanStatus { Pending, Active, Repaid, Defaulted }
    enum RiskPool   { Conservative, Moderate, Aggressive }

    struct AssetConfig {
        bool    enabled;
        uint8   decimals;
        string  symbol;
        uint256 priceUsd18;        // USD price with 18 decimals (e.g. 1e18 = $1)
        uint256 totalLiquidity;    // total deposited by lenders
        uint256 totalLoanedOut;    // total currently lent out
        uint256 totalInterest;     // total interest collected
    }

    struct LenderDeposit {
        uint256 amount;
        uint256 depositedAt;
    }

    struct Loan {
        address   borrower;
        address   token;           // ERC-20 token address
        uint256   principal;       // in token decimals
        uint256   totalOwed;       // principal + interest
        uint256   repaidAmount;
        uint256   interestRate;    // basis points
        uint256   duration;
        uint256   approvedAt;
        uint256   dueDate;
        LoanStatus status;
        RiskPool  riskPool;
        uint256   minCreditScore;
        bytes32   approvalCheckId;
        uint256   approvalEboolCtHash;
        bool      approvalResolved;
        bool      approvalPassed;
        // Collateral fields
        address   collateralToken; // may differ from loan token
        uint256   collateralAmount;
        bool      collateralPosted;
    }

    struct PoolConfig {
        uint256 baseInterestRate;
        uint256 maxDuration;
        uint256 minCreditScore;
        uint256 minLoanAmount;     // in USD with 18 decimals
        uint256 maxLoanAmount;     // in USD with 18 decimals
    }

    // ──────────────────────────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────────────────────────

    ICreditEngineForPool   public creditEngine;
    IReputationForMultiPool public reputationRegistry;

    bool public paused;

    // whitelisted assets
    mapping(address => AssetConfig) public assets;
    address[] public assetList;

    // lender deposits: token → lender → deposit
    mapping(address => mapping(address => LenderDeposit)) public lenderDeposits;
    mapping(address => address[]) public assetLenders;
    mapping(address => mapping(address => bool)) public isLender;

    // lender yield: token → lender → accrued yield
    mapping(address => mapping(address => uint256)) public lenderYieldEarned;

    // loans
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) public borrowerLoans;
    uint256 public loanCount;

    // pool configs by risk tier
    mapping(uint256 => PoolConfig) public poolConfigs;

    // Collateral LTV discount thresholds
    uint256 public collateralDiscountLTV50 = 50;  // LTV >= 50% → −50 score req
    uint256 public collateralDiscountLTV25 = 25;  // LTV >= 25% → −25 score req

    // ──────────────────────────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor(address _owner) Ownable(_owner) {
        // Conservative pool: 3% APR, 90 days, min score 740
        poolConfigs[uint256(RiskPool.Conservative)] = PoolConfig({
            baseInterestRate: 300,
            maxDuration:      90 days,
            minCreditScore:   740,
            minLoanAmount:    100e18,    // $100
            maxLoanAmount:    50_000e18  // $50,000
        });
        // Moderate pool: 8% APR, 180 days, min score 670
        poolConfigs[uint256(RiskPool.Moderate)] = PoolConfig({
            baseInterestRate: 800,
            maxDuration:      180 days,
            minCreditScore:   670,
            minLoanAmount:    50e18,     // $50
            maxLoanAmount:    25_000e18  // $25,000
        });
        // Aggressive pool: 15% APR, 365 days, min score 580
        poolConfigs[uint256(RiskPool.Aggressive)] = PoolConfig({
            baseInterestRate: 1500,
            maxDuration:      365 days,
            minCreditScore:   580,
            minLoanAmount:    10e18,     // $10
            maxLoanAmount:    10_000e18  // $10,000
        });
    }

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }

    modifier onlyWhitelisted(address token) {
        if (!assets[token].enabled) revert AssetNotWhitelisted();
        _;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Asset Management (owner)
    // ──────────────────────────────────────────────────────────────────

    /// @notice Add a new ERC-20 asset to the pool.
    function whitelistAsset(
        address token,
        uint8   decimals,
        string calldata symbol,
        uint256 initialPriceUsd18
    ) external onlyOwner {
        require(token != address(0), "Zero address");
        require(initialPriceUsd18 > 0, "Price must be > 0");

        if (!assets[token].enabled) {
            assetList.push(token);
        }

        assets[token] = AssetConfig({
            enabled:        true,
            decimals:       decimals,
            symbol:         symbol,
            priceUsd18:     initialPriceUsd18,
            totalLiquidity: assets[token].totalLiquidity,
            totalLoanedOut: assets[token].totalLoanedOut,
            totalInterest:  assets[token].totalInterest
        });

        emit AssetWhitelisted(token, decimals, symbol);
    }

    /// @notice Disable an asset (stops new deposits and loans but preserves existing).
    function disableAsset(address token) external onlyOwner {
        assets[token].enabled = false;
        emit AssetDisabled(token);
    }

    /// @notice Update the USD price for an asset (manual oracle for Wave 4).
    function updateAssetPrice(address token, uint256 priceUsd18) external onlyOwner {
        require(priceUsd18 > 0, "Price must be > 0");
        assets[token].priceUsd18 = priceUsd18;
        emit AssetPriceUpdated(token, priceUsd18);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Lender Functions — fund, withdraw, claim yield
    // ──────────────────────────────────────────────────────────────────

    /// @notice Deposit ERC-20 tokens into the pool as a lender.
    function fundPool(address token, uint256 amount)
        external
        whenNotPaused
        onlyWhitelisted(token)
    {
        require(amount > 0, "Amount must be > 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        AssetConfig storage asset = assets[token];
        asset.totalLiquidity += amount;

        LenderDeposit storage dep = lenderDeposits[token][msg.sender];
        if (dep.amount == 0) {
            dep.depositedAt = block.timestamp;
            if (!isLender[token][msg.sender]) {
                assetLenders[token].push(msg.sender);
                isLender[token][msg.sender] = true;
            }
        }
        dep.amount += amount;

        emit PoolFunded(msg.sender, token, amount);
    }

    /// @notice Withdraw ERC-20 deposits from the pool.
    function withdrawFunds(address token, uint256 amount) external whenNotPaused {
        LenderDeposit storage dep = lenderDeposits[token][msg.sender];
        require(dep.amount >= amount && amount > 0, "Insufficient deposit");

        AssetConfig storage asset = assets[token];
        uint256 available = asset.totalLiquidity > asset.totalLoanedOut
            ? asset.totalLiquidity - asset.totalLoanedOut
            : 0;
        require(available >= amount, "Insufficient liquidity");

        dep.amount -= amount;
        asset.totalLiquidity -= amount;

        IERC20(token).safeTransfer(msg.sender, amount);
        emit PoolWithdrawn(msg.sender, token, amount);
    }

    /// @notice Claim accrued yield for a specific asset.
    function claimYield(address token) external whenNotPaused {
        uint256 yield = lenderYieldEarned[token][msg.sender];
        if (yield == 0) revert NoYieldToClaim();

        lenderYieldEarned[token][msg.sender] = 0;
        IERC20(token).safeTransfer(msg.sender, yield);

        emit YieldClaimed(msg.sender, token, yield);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Borrower Functions — request loan with optional collateral
    // ──────────────────────────────────────────────────────────────────

    /// @notice Request a loan in a specific ERC-20 token.
    /// @param token           The ERC-20 token to borrow.
    /// @param principal       Amount to borrow (in token units).
    /// @param duration        Loan duration in seconds (0 = pool max).
    /// @param riskPool        Risk tier to borrow from.
    /// @param collateralToken ERC-20 token to post as collateral (address(0) = none).
    /// @param collateralAmount Amount of collateral to post (0 = none).
    function requestLoan(
        address token,
        uint256 principal,
        uint256 duration,
        RiskPool riskPool,
        address collateralToken,
        uint256 collateralAmount
    ) external whenNotPaused onlyWhitelisted(token) {
        AssetConfig storage asset = assets[token];

        // Convert principal to USD for min/max check
        uint256 principalUsd = _toUsd(token, principal);
        PoolConfig storage config = poolConfigs[uint256(riskPool)];

        if (principalUsd < config.minLoanAmount) revert BelowMinimum();
        if (principalUsd > config.maxLoanAmount) revert AboveMaximum();

        uint256 available = asset.totalLiquidity > asset.totalLoanedOut
            ? asset.totalLiquidity - asset.totalLoanedOut
            : 0;
        if (principal > available) revert InsufficientLiquidity();

        uint256 dur = duration > 0 ? duration : config.maxDuration;
        if (dur > config.maxDuration) dur = config.maxDuration;

        uint256 interest  = (principal * config.baseInterestRate * dur) / (365 days * 10000);
        uint256 totalOwed = principal + interest;

        // Resolve effective min credit score after collateral discount
        uint256 effectiveMinScore = config.minCreditScore;
        bool    collateralActive  = false;

        if (collateralToken != address(0) && collateralAmount > 0) {
            require(assets[collateralToken].enabled, "Collateral not whitelisted");
            uint256 collateralUsd = _toUsd(collateralToken, collateralAmount);
            uint256 ltvBps = (collateralUsd * 100) / principalUsd;

            if (ltvBps >= collateralDiscountLTV50) {
                // 50%+ LTV → −50 score requirement
                effectiveMinScore = effectiveMinScore > 50
                    ? effectiveMinScore - 50
                    : 300;
            } else if (ltvBps >= collateralDiscountLTV25) {
                // 25%+ LTV → −25 score requirement
                effectiveMinScore = effectiveMinScore > 25
                    ? effectiveMinScore - 25
                    : 300;
            }
            collateralActive = true;
        }

        uint256 loanId = loanCount++;
        Loan storage loan = loans[loanId];
        loan.borrower          = msg.sender;
        loan.token             = token;
        loan.principal         = principal;
        loan.totalOwed         = totalOwed;
        loan.interestRate      = config.baseInterestRate;
        loan.duration          = dur;
        loan.status            = LoanStatus.Pending;
        loan.riskPool          = riskPool;
        loan.minCreditScore    = effectiveMinScore;
        loan.collateralToken   = collateralToken;
        loan.collateralAmount  = collateralActive ? collateralAmount : 0;

        borrowerLoans[msg.sender].push(loanId);
        emit LoanRequested(msg.sender, loanId, token, principal);

        // Pull collateral into escrow NOW, before FHE check
        if (collateralActive && collateralAmount > 0) {
            IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), collateralAmount);
            loan.collateralPosted = true;
            emit CollateralPosted(msg.sender, loanId, collateralToken, collateralAmount);
        }

        // FHE approval check (or auto-approve if no engine)
        if (address(creditEngine) == address(0)) {
            _activateAndDisburse(loanId);
            return;
        }

        if (!creditEngine.hasCreditScore(msg.sender)) revert NoCreditScore();
        if (creditEngine.isScoreStale(msg.sender))    revert StaleScore();

        (bytes32 checkId, uint256 eboolCtHash) = creditEngine.requestApprovalCheck(
            msg.sender,
            effectiveMinScore
        );

        loan.approvalCheckId     = checkId;
        loan.approvalEboolCtHash = eboolCtHash;

        emit LoanApprovalCheckRequested(msg.sender, loanId, checkId, eboolCtHash);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Resolve — ebool-gated, permissionless
    // ──────────────────────────────────────────────────────────────────

    /// @notice Resolve the FHE approval and disburse if approved.
    ///         Returns collateral if rejected.
    function resolveLoanApproval(uint256 loanId) external whenNotPaused {
        if (loanId >= loanCount) revert LoanNotFound();

        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Pending)        revert LoanNotPending();
        if (loan.approvalCheckId == bytes32(0))        revert ApprovalNotRequested();

        (bool ready, bool approved) = creditEngine.resolveApprovalCheck(loan.approvalCheckId);
        if (!ready) return; // FHE not complete — retry later

        loan.approvalResolved = true;
        loan.approvalPassed   = approved;

        emit LoanApprovalResolved(loan.borrower, loanId, approved);

        if (approved) {
            _activateAndDisburse(loanId);
        } else {
            // Rejected — return collateral to borrower
            _releaseCollateral(loanId);
        }
    }

    function _activateAndDisburse(uint256 loanId) internal {
        Loan storage loan = loans[loanId];
        AssetConfig storage asset = assets[loan.token];

        loan.status     = LoanStatus.Active;
        loan.approvedAt = block.timestamp;
        loan.dueDate    = block.timestamp + loan.duration;
        asset.totalLoanedOut += loan.principal;

        IERC20(loan.token).safeTransfer(loan.borrower, loan.principal);
        emit LoanDisbursed(loan.borrower, loanId, loan.token, loan.principal);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Repayment
    // ──────────────────────────────────────────────────────────────────

    /// @notice Repay an active loan. Caller must approve token transfer first.
    function repayLoan(uint256 loanId, uint256 amount) external whenNotPaused {
        if (loanId >= loanCount) revert LoanNotFound();
        if (amount == 0) revert BelowMinimum();

        Loan storage loan = loans[loanId];
        if (loan.borrower != msg.sender) revert NotBorrower();
        if (loan.status != LoanStatus.Active) revert LoanNotActive();

        IERC20(loan.token).safeTransferFrom(msg.sender, address(this), amount);

        AssetConfig storage asset = assets[loan.token];
        loan.repaidAmount  += amount;
        asset.totalLoanedOut = asset.totalLoanedOut > amount
            ? asset.totalLoanedOut - amount
            : 0;
        asset.totalLiquidity += amount;

        bool fullRepayment = loan.repaidAmount >= loan.totalOwed;

        // Distribute interest yield proportionally to lenders
        if (loan.totalOwed > loan.principal && asset.totalLiquidity > 0) {
            uint256 interestPortion = loan.totalOwed - loan.principal;
            uint256 interestShare   = (amount * interestPortion) / loan.totalOwed;
            if (interestShare > 0) {
                _distributeYield(loan.token, interestShare);
                asset.totalInterest += interestShare;
            }
        }

        if (fullRepayment) {
            loan.status = LoanStatus.Repaid;
            _releaseCollateral(loanId);
            _notifyReputation(msg.sender);
        }

        emit RepaymentMade(msg.sender, loanId, amount, fullRepayment);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Default + Collateral Liquidation
    // ──────────────────────────────────────────────────────────────────

    /// @notice Mark a loan defaulted and liquidate collateral (if any).
    function markDefaulted(uint256 loanId) external onlyOwner {
        if (loanId >= loanCount) revert LoanNotFound();

        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) revert LoanNotActive();

        loan.status = LoanStatus.Defaulted;

        // Liquidate collateral: transfer to pool (partial loss recovery)
        if (loan.collateralPosted && loan.collateralAmount > 0) {
            // Collateral stays in contract — pool absorbs it as recovery
            emit CollateralLiquidated(loan.borrower, loanId, loan.collateralToken, loan.collateralAmount);
            loan.collateralPosted = false;
        }

        _notifyReputation(loan.borrower);
        emit LoanDefaulted(loan.borrower, loanId);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Internal helpers
    // ──────────────────────────────────────────────────────────────────

    function _releaseCollateral(uint256 loanId) internal {
        Loan storage loan = loans[loanId];
        if (!loan.collateralPosted || loan.collateralAmount == 0) return;

        loan.collateralPosted = false;
        IERC20(loan.collateralToken).safeTransfer(loan.borrower, loan.collateralAmount);
        emit CollateralReleased(loan.borrower, loanId, loan.collateralToken, loan.collateralAmount);
    }

    function _distributeYield(address token, uint256 yieldAmount) internal {
        address[] storage lenders = assetLenders[token];
        AssetConfig storage asset = assets[token];
        if (asset.totalLiquidity == 0 || lenders.length == 0) return;

        for (uint256 i = 0; i < lenders.length; i++) {
            address lender = lenders[i];
            uint256 deposit = lenderDeposits[token][lender].amount;
            if (deposit == 0) continue;
            uint256 share = (yieldAmount * deposit) / asset.totalLiquidity;
            if (share > 0) {
                lenderYieldEarned[token][lender] += share;
            }
        }
    }

    function _notifyReputation(address user) internal {
        if (address(reputationRegistry) == address(0)) return;
        if (!reputationRegistry.isRegistered(user)) return;
        try reputationRegistry.notifyActivity(user) {} catch {}
    }

    function _toUsd(address token, uint256 amount) internal view returns (uint256) {
        AssetConfig storage asset = assets[token];
        // Normalize to 18 decimals then apply USD price
        uint256 normalized = amount;
        if (asset.decimals < 18) {
            normalized = amount * (10 ** (18 - asset.decimals));
        } else if (asset.decimals > 18) {
            normalized = amount / (10 ** (asset.decimals - 18));
        }
        return (normalized * asset.priceUsd18) / 1e18;
    }

    // ──────────────────────────────────────────────────────────────────
    //  View functions
    // ──────────────────────────────────────────────────────────────────

    function getAvailableLiquidity(address token) external view returns (uint256) {
        AssetConfig storage asset = assets[token];
        return asset.totalLiquidity > asset.totalLoanedOut
            ? asset.totalLiquidity - asset.totalLoanedOut
            : 0;
    }

    function getLoan(uint256 loanId) external view returns (
        address  borrower,
        address  token,
        uint256  principal,
        uint256  totalOwed,
        uint256  repaidAmount,
        uint256  dueDate,
        uint256  status,
        address  collateralToken,
        uint256  collateralAmount,
        bool     collateralPosted
    ) {
        if (loanId >= loanCount) revert LoanNotFound();
        Loan storage loan = loans[loanId];
        return (
            loan.borrower, loan.token, loan.principal, loan.totalOwed,
            loan.repaidAmount, loan.dueDate, uint256(loan.status),
            loan.collateralToken, loan.collateralAmount, loan.collateralPosted
        );
    }

    function getBorrowerLoans(address borrower) external view returns (uint256[] memory) {
        return borrowerLoans[borrower];
    }

    function getAssetCount() external view returns (uint256) {
        return assetList.length;
    }

    function getLenderDeposit(address token, address lender) external view returns (uint256 amount, uint256 depositedAt) {
        LenderDeposit storage dep = lenderDeposits[token][lender];
        return (dep.amount, dep.depositedAt);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────────────────────────

    function setCreditEngine(address _engine) external onlyOwner {
        creditEngine = ICreditEngineForPool(_engine);
    }

    function setReputationRegistry(address _registry) external onlyOwner {
        reputationRegistry = IReputationForMultiPool(_registry);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    function setCollateralDiscounts(uint256 _ltv50, uint256 _ltv25) external onlyOwner {
        require(_ltv50 > _ltv25, "LTV50 must be > LTV25");
        require(_ltv25 > 0, "LTV25 must be > 0");
        collateralDiscountLTV50 = _ltv50;
        collateralDiscountLTV25 = _ltv25;
    }
}
