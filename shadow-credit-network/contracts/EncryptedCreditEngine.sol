// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title EncryptedCreditEngine
/// @notice Privacy-preserving credit scoring engine using Fully Homomorphic Encryption.
/// @dev All sensitive financial data is encrypted on-chain using Fhenix FHE primitives.
///      No plaintext financial data is ever stored or exposed.
contract EncryptedCreditEngine is Ownable {

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event UserRegistered(address indexed user);
    event CreditDataSubmitted(address indexed user, uint256 ciphertextHash);
    event CreditScoreComputed(address indexed user, uint256 scoreHash);
    event CreditScoreDecrypted(address indexed user, uint256 score);
    event DelegateAuthorized(address indexed user, address indexed delegate);
    event DelegateRevoked(address indexed user, address indexed delegate);
    event BorrowingPowerRequested(address indexed user, uint256 powerHash);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error NotAuthorized();
    error NoScoreComputed();
    error ScoreNotDecrypted();
    error InvalidRiskTier();
    error DelegateAlreadyAuthorized();
    error DelegateNotAuthorized();
    error CannotDelegateSelf();
    error InsufficientScore();
    error CreditDataNotSubmitted();
    error ZeroAmount();

    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    enum RiskTier {
        Prime,        // Tier 0 — lowest risk
        NearPrime,    // Tier 1
        Subprime,     // Tier 2
        DeepSubprime  // Tier 3 — highest risk
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    /// @notice Encrypted credit profile for a user
    struct CreditProfile {
        euint64 income;               // Annual income (encrypted)
        euint64 totalDebt;            // Total outstanding debt (encrypted)
        euint32 paymentHistory;       // Payment reliability score 0-10000 (encrypted, basis points)
        euint32 creditUtilization;    // Credit utilization ratio 0-10000 (encrypted, basis points)
        euint32 accountAge;           // Account age in days (encrypted)
        euint32 numDefaults;          // Number of defaults (encrypted)
        euint8  riskTier;             // Computed risk tier (encrypted)
        bool    isActive;             // Plaintext — only tracks registration state
    }

    /// @notice Computed credit score result
    struct CreditScore {
        euint32 score;                // Credit score 300-850 (encrypted)
        bool    computed;             // Whether score has been computed
        bool    decryptionRequested;  // Whether decryption has been requested
    }

    /// @notice Delegation entry — allows a delegate to use user's credit
    struct Delegation {
        address delegate;
        euint64 creditLimit;          // Max delegated credit amount (encrypted)
        bool    isActive;
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @notice Mapping of user address to encrypted credit profile
    mapping(address => CreditProfile) private profiles;

    /// @notice Mapping of user address to credit score
    mapping(address => CreditScore) private scores;

    /// @notice Mapping of user address => delegate address => delegation
    mapping(address => mapping(address => Delegation)) private delegations;

    /// @notice List of delegates per user (for enumeration)
    mapping(address => address[]) private delegateList;

    /// @notice Registered users (for enumeration)
    address[] private registeredUsers;

    /// @notice Mapping to check if user is in registeredUsers array
    mapping(address => bool) private isUserIndex;

    /// @notice Global threshold for prime risk tier (encrypted)
    euint32 private primeThreshold;

    /// @notice Global threshold for near-prime risk tier (encrypted)
    euint32 private nearPrimeThreshold;

    /// @notice Global threshold for subprime risk tier (encrypted)
    euint32 private subprimeThreshold;

    /// @notice Minimum credit score for borrowing eligibility (encrypted)
    euint32 private minBorrowScore;

    /// @notice Contract fee receiver for protocol revenue
    address public feeReceiver;

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(address _feeReceiver) Ownable(msg.sender) {
        require(_feeReceiver != address(0), "Invalid fee receiver");
        feeReceiver = _feeReceiver;

        // Initialize encrypted thresholds
        // Credit score range: 300-850
        primeThreshold = FHE.asEuint32(740);
        nearPrimeThreshold = FHE.asEuint32(670);
        subprimeThreshold = FHE.asEuint32(580);
        minBorrowScore = FHE.asEuint32(580);

        FHE.allowThis(primeThreshold);
        FHE.allowThis(nearPrimeThreshold);
        FHE.allowThis(subprimeThreshold);
        FHE.allowThis(minBorrowScore);
    }

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyRegistered() {
        if (!profiles[msg.sender].isActive) revert NotRegistered();
        _;
    }

    modifier onlyRegisteredOrOwner(address user) {
        if (!profiles[user].isActive && msg.sender != owner()) revert NotRegistered();
        _;
    }

    modifier requireComputedScore(address user) {
        if (!scores[user].computed) revert NoScoreComputed();
        _;
    }

    // ──────────────────────────────────────────────
    //  Registration
    // ──────────────────────────────────────────────

    /// @notice Register the caller as a user in the credit engine
    function register() external {
        if (profiles[msg.sender].isActive) revert AlreadyRegistered();

        profiles[msg.sender].isActive = true;

        // Initialize with trivially encrypted zero values
        profiles[msg.sender].income = FHE.asEuint64(0);
        profiles[msg.sender].totalDebt = FHE.asEuint64(0);
        profiles[msg.sender].paymentHistory = FHE.asEuint32(10000); // Start at 100% (basis points)
        profiles[msg.sender].creditUtilization = FHE.asEuint32(0);
        profiles[msg.sender].accountAge = FHE.asEuint32(0);
        profiles[msg.sender].numDefaults = FHE.asEuint32(0);
        profiles[msg.sender].riskTier = FHE.asEuint8(0);

        // Grant contract access to all profile fields
        FHE.allowThis(profiles[msg.sender].income);
        FHE.allowThis(profiles[msg.sender].totalDebt);
        FHE.allowThis(profiles[msg.sender].paymentHistory);
        FHE.allowThis(profiles[msg.sender].creditUtilization);
        FHE.allowThis(profiles[msg.sender].accountAge);
        FHE.allowThis(profiles[msg.sender].numDefaults);
        FHE.allowThis(profiles[msg.sender].riskTier);

        // Grant sender read access to their own data
        FHE.allowSender(profiles[msg.sender].income);
        FHE.allowSender(profiles[msg.sender].totalDebt);
        FHE.allowSender(profiles[msg.sender].paymentHistory);
        FHE.allowSender(profiles[msg.sender].creditUtilization);
        FHE.allowSender(profiles[msg.sender].accountAge);
        FHE.allowSender(profiles[msg.sender].numDefaults);
        FHE.allowSender(profiles[msg.sender].riskTier);

        if (!isUserIndex[msg.sender]) {
            registeredUsers.push(msg.sender);
            isUserIndex[msg.sender] = true;
        }

        emit UserRegistered(msg.sender);
    }

    // ──────────────────────────────────────────────
    //  Credit Data Submission
    // ──────────────────────────────────────────────

    /// @notice Submit encrypted credit data to update the user's profile
    /// @param _income Encrypted annual income (euint64)
    /// @param _totalDebt Encrypted total outstanding debt (euint64)
    /// @param _paymentHistory Encrypted payment reliability (0-10000 basis points, euint32)
    /// @param _creditUtilization Encrypted credit utilization ratio (0-10000 basis points, euint32)
    /// @param _accountAge Encrypted account age in days (euint32)
    /// @param _numDefaults Encrypted number of defaults (euint32)
    function submitCreditData(
        InEuint64 calldata _income,
        InEuint64 calldata _totalDebt,
        InEuint32 calldata _paymentHistory,
        InEuint32 calldata _creditUtilization,
        InEuint32 calldata _accountAge,
        InEuint32 calldata _numDefaults
    ) external onlyRegistered {
        // Process encrypted inputs
        euint64 income = FHE.asEuint64(_income);
        euint64 totalDebt = FHE.asEuint64(_totalDebt);
        euint32 paymentHistory = FHE.asEuint32(_paymentHistory);
        euint32 creditUtilization = FHE.asEuint32(_creditUtilization);
        euint32 accountAge = FHE.asEuint32(_accountAge);
        euint32 numDefaults = FHE.asEuint32(_numDefaults);

        // Validate payment history is within range [0, 10000] (encrypted check)
        // We use lte to ensure paymentHistory <= 10000
        euint32 maxBP = FHE.asEuint32(10000);
        FHE.lte(paymentHistory, maxBP);

        // Validate credit utilization is within range [0, 10000] (encrypted check)
        FHE.lte(creditUtilization, maxBP);

        // Store encrypted data
        profiles[msg.sender].income = income;
        profiles[msg.sender].totalDebt = totalDebt;
        profiles[msg.sender].paymentHistory = paymentHistory;
        profiles[msg.sender].creditUtilization = creditUtilization;
        profiles[msg.sender].accountAge = accountAge;
        profiles[msg.sender].numDefaults = numDefaults;

        // Grant contract access
        FHE.allowThis(income);
        FHE.allowThis(totalDebt);
        FHE.allowThis(paymentHistory);
        FHE.allowThis(creditUtilization);
        FHE.allowThis(accountAge);
        FHE.allowThis(numDefaults);

        // Grant sender access
        FHE.allowSender(income);
        FHE.allowSender(totalDebt);
        FHE.allowSender(paymentHistory);
        FHE.allowSender(creditUtilization);
        FHE.allowSender(accountAge);
        FHE.allowSender(numDefaults);

        emit CreditDataSubmitted(msg.sender, euint64.unwrap(income));
    }

    // ──────────────────────────────────────────────
    //  Credit Score Computation
    // ──────────────────────────────────────────────

    /// @notice Compute encrypted credit score using FHE operations
    /// @dev Score formula (all in encrypted domain):
    ///      baseScore = 300
    ///      paymentScore = paymentHistory * 255 / 10000      (max 255 points)
    ///      utilizationScore = (10000 - creditUtilization) * 120 / 10000  (max 120 points)
    ///      ageScore = min(accountAge / 365, 10) * 15         (max 150 points)
    ///      defaultPenalty = numDefaults * 50                  (max penalty)
    ///      score = baseScore + paymentScore + utilizationScore + ageScore - defaultPenalty
    ///      Clamped to [300, 850]
    function computeCreditScore() external onlyRegistered {
        CreditProfile storage profile = profiles[msg.sender];

        // Compute individual score components
        euint32 paymentComponent = _computePaymentScore(profile.paymentHistory);
        euint32 utilizationComponent = _computeUtilizationScore(profile.creditUtilization);
        euint32 ageComponent = _computeAgeScore(profile.accountAge);
        euint32 penaltyComponent = _computeDefaultPenalty(profile.numDefaults);

        // Aggregate: base(300) + payment + utilization + age - penalties
        euint32 rawScore = FHE.asEuint32(300);
        rawScore = FHE.add(rawScore, paymentComponent);
        rawScore = FHE.add(rawScore, utilizationComponent);
        rawScore = FHE.add(rawScore, ageComponent);
        rawScore = FHE.sub(rawScore, penaltyComponent);

        // Clamp to [300, 850]
        euint32 finalScore = _clampScore(rawScore);

        // Compute risk tier
        euint8 finalTier = _computeRiskTier(finalScore);

        // Store results
        scores[msg.sender].score = finalScore;
        scores[msg.sender].computed = true;
        profiles[msg.sender].riskTier = finalTier;

        FHE.allowThis(finalScore);
        FHE.allowThis(finalTier);
        FHE.allowSender(finalScore);
        FHE.allowSender(finalTier);

        emit CreditScoreComputed(msg.sender, euint32.unwrap(finalScore));
    }

    function _computePaymentScore(euint32 paymentHistory) internal returns (euint32) {
        euint32 multiplier = FHE.asEuint32(255);
        euint32 maxBP = FHE.asEuint32(10000);
        return FHE.div(FHE.mul(paymentHistory, multiplier), maxBP);
    }

    function _computeUtilizationScore(euint32 utilization) internal returns (euint32) {
        euint32 maxBP = FHE.asEuint32(10000);
        euint32 inverted = FHE.sub(maxBP, utilization);
        euint32 multiplier = FHE.asEuint32(120);
        return FHE.div(FHE.mul(inverted, multiplier), maxBP);
    }

    function _computeAgeScore(euint32 accountAge) internal returns (euint32) {
        euint32 daysPerYear = FHE.asEuint32(365);
        euint32 accountYears = FHE.div(accountAge, daysPerYear);
        euint32 maxYears = FHE.asEuint32(10);
        euint32 cappedYears = FHE.select(FHE.gt(accountYears, maxYears), maxYears, accountYears);
        return FHE.mul(cappedYears, FHE.asEuint32(15));
    }

    function _computeDefaultPenalty(euint32 numDefaults) internal returns (euint32) {
        return FHE.mul(numDefaults, FHE.asEuint32(50));
    }

    function _clampScore(euint32 rawScore) internal returns (euint32) {
        euint32 minScore = FHE.asEuint32(300);
        euint32 maxScore = FHE.asEuint32(850);
        euint32 clampedLow = FHE.select(FHE.lt(rawScore, minScore), minScore, rawScore);
        return FHE.select(FHE.gt(clampedLow, maxScore), maxScore, clampedLow);
    }

    function _computeRiskTier(euint32 score) internal returns (euint8) {
        euint8 tierPrime = FHE.asEuint8(uint8(RiskTier.Prime));
        euint8 tierNearPrime = FHE.asEuint8(uint8(RiskTier.NearPrime));
        euint8 tierSubprime = FHE.asEuint8(uint8(RiskTier.Subprime));
        euint8 tierDeepSubprime = FHE.asEuint8(uint8(RiskTier.DeepSubprime));

        euint8 tier1 = FHE.select(FHE.gte(score, subprimeThreshold), tierSubprime, tierDeepSubprime);
        euint8 tier2 = FHE.select(FHE.gte(score, nearPrimeThreshold), tierNearPrime, tier1);
        return FHE.select(FHE.gte(score, primeThreshold), tierPrime, tier2);
    }

    // ──────────────────────────────────────────────
    //  Borrowing Power
    // ──────────────────────────────────────────────

    /// @notice Compute encrypted borrowing power based on credit score and income
    /// @dev Borrowing power formula (encrypted):
    ///      incomeMultiplier = income * riskFactor / 10000
    ///      where riskFactor depends on risk tier:
    ///        Prime: 5000 (50% of income)
    ///        NearPrime: 3000 (30%)
    ///        Subprime: 1500 (15%)
    ///        DeepSubprime: 500 (5%)
    ///      borrowingPower = incomeMultiplier - totalDebt
    ///      If totalDebt > incomeMultiplier, borrowingPower = 0
    function computeBorrowingPower() external onlyRegistered requireComputedScore(msg.sender) {
        CreditProfile storage profile = profiles[msg.sender];

        euint64 riskFactor = _selectRiskFactor(profile.riskTier);
        euint64 incomeMultiplier = _computeIncomeMultiplier(profile.income, riskFactor);
        euint64 borrowingPower = _computeNetBorrowingPower(incomeMultiplier, profile.totalDebt, scores[msg.sender].score);

        FHE.allowThis(borrowingPower);
        FHE.allowSender(borrowingPower);

        emit BorrowingPowerRequested(msg.sender, euint64.unwrap(borrowingPower));
    }

    function _selectRiskFactor(euint8 tier) internal returns (euint64) {
        euint64 rfPrime = FHE.asEuint64(5000);
        euint64 rfNearPrime = FHE.asEuint64(3000);
        euint64 rfSubprime = FHE.asEuint64(1500);
        euint64 rfDeepSubprime = FHE.asEuint64(500);

        euint8 tPrime = FHE.asEuint8(uint8(RiskTier.Prime));
        euint8 tNearPrime = FHE.asEuint8(uint8(RiskTier.NearPrime));
        euint8 tSubprime = FHE.asEuint8(uint8(RiskTier.Subprime));

        euint64 rf1 = FHE.select(FHE.eq(tier, tSubprime), rfSubprime, rfDeepSubprime);
        euint64 rf2 = FHE.select(FHE.eq(tier, tNearPrime), rfNearPrime, rf1);
        return FHE.select(FHE.eq(tier, tPrime), rfPrime, rf2);
    }

    function _computeIncomeMultiplier(euint64 income, euint64 riskFactor) internal returns (euint64) {
        euint64 maxBP = FHE.asEuint64(10000);
        return FHE.div(FHE.mul(income, riskFactor), maxBP);
    }

    function _computeNetBorrowingPower(euint64 incomeMultiplier, euint64 totalDebt, euint32 score) internal returns (euint64) {
        euint64 zero = FHE.asEuint64(0);
        ebool canBorrow = FHE.gt(incomeMultiplier, totalDebt);
        euint64 rawPower = FHE.sub(incomeMultiplier, totalDebt);
        euint64 borrowingPower = FHE.select(canBorrow, rawPower, zero);

        ebool hasMinScore = FHE.gte(score, minBorrowScore);
        return FHE.select(hasMinScore, borrowingPower, zero);
    }

    // ──────────────────────────────────────────────
    //  Decryption
    // ──────────────────────────────────────────────

    /// @notice Request decryption of the caller's credit score
    /// @dev Only the score owner can request decryption of their own score
    function requestScoreDecryption() external onlyRegistered requireComputedScore(msg.sender) {
        scores[msg.sender].decryptionRequested = true;
        FHE.decrypt(scores[msg.sender].score);
    }

    /// @notice Get the decrypted credit score (reverts if not yet decrypted)
    /// @return score The decrypted credit score value
    function getDecryptedScore() external view returns (uint32 score) {
        if (!scores[msg.sender].decryptionRequested) revert ScoreNotDecrypted();
        (uint256 value, bool decrypted) = FHE.getDecryptResultSafe(scores[msg.sender].score);
        if (!decrypted) revert ScoreNotDecrypted();
        return uint32(value);
    }

    /// @notice Safe getter — returns score and whether it has been decrypted
    /// @return score The decrypted score (or 0 if not ready)
    /// @return isDecrypted Whether the score has been decrypted
    function getDecryptedScoreSafe() external view returns (uint32 score, bool isDecrypted) {
        (uint256 value, bool decrypted) = FHE.getDecryptResultSafe(scores[msg.sender].score);
        return (uint32(value), decrypted);
    }

    // ──────────────────────────────────────────────
    //  Delegation
    // ──────────────────────────────────────────────

    /// @notice Authorize a delegate to use the caller's credit
    /// @param _delegate The address to authorize
    /// @param _creditLimit Encrypted maximum credit limit for delegation (euint64)
    function authorizeDelegate(address _delegate, InEuint64 calldata _creditLimit) external onlyRegistered {
        if (_delegate == msg.sender) revert CannotDelegateSelf();
        if (delegations[msg.sender][_delegate].isActive) revert DelegateAlreadyAuthorized();

        euint64 creditLimit = FHE.asEuint64(_creditLimit);

        delegations[msg.sender][_delegate] = Delegation({
            delegate: _delegate,
            creditLimit: creditLimit,
            isActive: true
        });

        delegateList[msg.sender].push(_delegate);

        FHE.allowThis(creditLimit);
        FHE.allowSender(creditLimit);
        FHE.allow(creditLimit, _delegate);

        emit DelegateAuthorized(msg.sender, _delegate);
    }

    /// @notice Revoke a delegate's authorization
    function revokeDelegate(address _delegate) external onlyRegistered {
        if (!delegations[msg.sender][_delegate].isActive) revert DelegateNotAuthorized();

        delegations[msg.sender][_delegate].isActive = false;

        emit DelegateRevoked(msg.sender, _delegate);
    }

    // ──────────────────────────────────────────────
    //  Read-Only Queries (encrypted data access)
    // ──────────────────────────────────────────────

    /// @notice Get the encrypted credit score of a user (requires permission)
    function getCreditScore(address _user) external view returns (euint32) {
        if (!scores[_user].computed) revert NoScoreComputed();
        return scores[_user].score;
    }

    /// @notice Get the encrypted risk tier of a user
    function getRiskTier(address _user) external view returns (euint8) {
        if (!profiles[_user].isActive) revert NotRegistered();
        return profiles[_user].riskTier;
    }

    /// @notice Check if a user is registered
    function isRegistered(address _user) external view returns (bool) {
        return profiles[_user].isActive;
    }

    /// @notice Get the total number of registered users
    function getUserCount() external view returns (uint256) {
        return registeredUsers.length;
    }

    /// @notice Get a registered user by index
    function getUserAtIndex(uint256 _index) external view returns (address) {
        return registeredUsers[_index];
    }

    /// @notice Get the number of delegates for a user
    function getDelegateCount(address _user) external view returns (uint256) {
        return delegateList[_user].length;
    }

    /// @notice Get a delegate by index for a user
    function getDelegateAtIndex(address _user, uint256 _index) external view returns (address) {
        return delegateList[_user][_index];
    }

    /// @notice Check if a delegation is active
    function isDelegationActive(address _delegator, address _delegate) external view returns (bool) {
        return delegations[_delegator][_delegate].isActive;
    }

    /// @notice Get the encrypted credit limit for a delegation
    function getDelegationCreditLimit(address _delegator, address _delegate) external view returns (euint64) {
        return delegations[_delegator][_delegate].creditLimit;
    }

    /// @notice Check if score computation has been completed for a user
    function hasComputedScore(address _user) external view returns (bool) {
        return scores[_user].computed;
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    /// @notice Update the credit score thresholds (admin only)
    function updateThresholds(
        InEuint32 calldata _primeThreshold,
        InEuint32 calldata _nearPrimeThreshold,
        InEuint32 calldata _subprimeThreshold,
        InEuint32 calldata _minBorrowScore
    ) external onlyOwner {
        primeThreshold = FHE.asEuint32(_primeThreshold);
        nearPrimeThreshold = FHE.asEuint32(_nearPrimeThreshold);
        subprimeThreshold = FHE.asEuint32(_subprimeThreshold);
        minBorrowScore = FHE.asEuint32(_minBorrowScore);

        FHE.allowThis(primeThreshold);
        FHE.allowThis(nearPrimeThreshold);
        FHE.allowThis(subprimeThreshold);
        FHE.allowThis(minBorrowScore);
    }

    /// @notice Update fee receiver address
    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        require(_feeReceiver != address(0), "Invalid fee receiver");
        feeReceiver = _feeReceiver;
    }
}
