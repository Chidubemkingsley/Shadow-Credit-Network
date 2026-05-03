// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title EncryptedCreditEngineV3
/// @notice Wave 3 upgrade of the FHE credit scoring engine.
///
/// New in V3 vs V2:
///   1. Score expiry — scores older than `scoreValidityPeriod` are rejected by
///      requestApprovalCheck(), forcing borrowers to keep data current.
///   2. Score history — every computeCreditScore() appends the ciphertext handle
///      to a per-user history array, enabling trajectory proofs to third parties.
///   3. Cross-contract score sharing — authorizedContracts + grantScoreAccess()
///      let third-party protocols read a user's encrypted score with user consent.
///   4. Encrypted borrowing power — computeBorrowingPower() returns an euint64
///      derived from encrypted income × risk factor − totalDebt, all in FHE domain.
///   5. Reputation hook — after computeCreditScore(), if a ReputationRegistry is
///      wired in, the engine trivially-encrypts a high TransactionReliability score
///      and calls updateReputation() to reflect protocol activity.
///
/// Decryption pattern (cofhe-contracts v0.0.13):
///   FHE.decrypt(ctHash) → async → FHE.getDecryptResultSafe() polls until ready.
contract EncryptedCreditEngineV3 is Ownable {

    // ──────────────────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────────────────

    event UserRegistered(address indexed user);
    event CreditDataSubmitted(address indexed user);
    event CreditScoreComputed(address indexed user, uint256 scoreCtHash);
    event ScoreDecryptionRequested(address indexed user, uint256 ctHash);
    event BorrowingPowerComputed(address indexed user, uint256 powerCtHash);
    event ApprovalCheckCreated(bytes32 indexed checkId, address indexed user, uint256 minScore, uint256 eboolCtHash);
    event ApprovalCheckResolved(bytes32 indexed checkId, address indexed user, bool approved);
    event ContractAuthorized(address indexed contractAddr);
    event ContractRevoked(address indexed contractAddr);
    event ScoreAccessGranted(address indexed user, address indexed recipient);
    event ReputationRegistrySet(address indexed registry);

    // ──────────────────────────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error NoCreditData();
    error ScoreNotDecrypted();
    error CheckNotFound();
    error StaleScore();           // NEW: score older than scoreValidityPeriod
    error NotAuthorizedContract();

    // ──────────────────────────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────────────────────────

    // Encrypted credit profiles
    mapping(address => euint64) private encIncome;
    mapping(address => euint64) private encTotalDebt;
    mapping(address => euint32) private encPaymentHistory;
    mapping(address => euint32) private encCreditUtilization;
    mapping(address => euint32) private encAccountAge;
    mapping(address => euint32) private encNumDefaults;

    // Computed scores
    mapping(address => euint32) private encCreditScore;
    mapping(address => bool)    public  hasCreditScore;
    mapping(address => bool)    public  isRegistered;

    // NEW: score timestamps for expiry enforcement
    mapping(address => uint256) public scoreComputedAt;

    // NEW: score history — array of ciphertext handles (euint32.unwrap values)
    // Lets users prove score trajectory to third-party protocols without revealing values.
    mapping(address => uint256[]) public scoreHistory;

    // NEW: encrypted borrowing power (euint64 ciphertext handle)
    mapping(address => euint64) private encBorrowingPower;
    mapping(address => bool)    public  hasBorrowingPower;

    // Approval checks (ebool-gated loan disbursement)
    struct ApprovalCheck {
        address user;
        uint256 minScore;
        ebool   result;
        bool    exists;
        bool    resolved;
        bool    approved;
    }
    mapping(bytes32 => ApprovalCheck) private approvalChecks;

    // NEW: cross-contract score sharing
    mapping(address => bool) public authorizedContracts;

    // Score validity period (default 180 days — owner can update)
    uint256 public scoreValidityPeriod = 180 days;

    // Thresholds (trivially encrypted — values are public knowledge)
    euint32 public primeThreshold;
    euint32 public nearPrimeThreshold;
    euint32 public subprimeThreshold;
    euint32 public minBorrowScore;

    address[] public registeredUsers;

    // NEW: optional ReputationRegistry integration
    address public reputationRegistry;

    // ──────────────────────────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor(address _owner) Ownable(_owner) {
        primeThreshold    = FHE.asEuint32(740);
        nearPrimeThreshold = FHE.asEuint32(670);
        subprimeThreshold  = FHE.asEuint32(580);
        minBorrowScore     = FHE.asEuint32(580);

        FHE.allowThis(primeThreshold);
        FHE.allowThis(nearPrimeThreshold);
        FHE.allowThis(subprimeThreshold);
        FHE.allowThis(minBorrowScore);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Registration
    // ──────────────────────────────────────────────────────────────────

    function register() external {
        if (isRegistered[msg.sender]) revert AlreadyRegistered();
        isRegistered[msg.sender] = true;
        registeredUsers.push(msg.sender);
        emit UserRegistered(msg.sender);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Credit Data Submission — real InEuint* ciphertexts from CoFHE SDK
    //
    //  Each InEuint* carries a ZK proof of knowledge generated by:
    //    cofheClient.encryptInputs([Encryptable.uint64(value), ...]).execute()
    //  FHE.asEuint*(InEuint*) verifies the proof and registers the ciphertext
    //  with the ACL in a single operation.
    // ──────────────────────────────────────────────────────────────────

    function submitCreditData(
        InEuint64 calldata _income,
        InEuint64 calldata _totalDebt,
        InEuint32 calldata _paymentHistory,
        InEuint32 calldata _creditUtilization,
        InEuint32 calldata _accountAge,
        InEuint32 calldata _numDefaults
    ) external {
        if (!isRegistered[msg.sender]) revert NotRegistered();

        encIncome[msg.sender]            = FHE.asEuint64(_income);
        encTotalDebt[msg.sender]         = FHE.asEuint64(_totalDebt);
        encPaymentHistory[msg.sender]    = FHE.asEuint32(_paymentHistory);
        encCreditUtilization[msg.sender] = FHE.asEuint32(_creditUtilization);
        encAccountAge[msg.sender]        = FHE.asEuint32(_accountAge);
        encNumDefaults[msg.sender]       = FHE.asEuint32(_numDefaults);

        FHE.allowThis(encIncome[msg.sender]);
        FHE.allowThis(encTotalDebt[msg.sender]);
        FHE.allowThis(encPaymentHistory[msg.sender]);
        FHE.allowThis(encCreditUtilization[msg.sender]);
        FHE.allowThis(encAccountAge[msg.sender]);
        FHE.allowThis(encNumDefaults[msg.sender]);

        FHE.allowSender(encIncome[msg.sender]);
        FHE.allowSender(encTotalDebt[msg.sender]);
        FHE.allowSender(encPaymentHistory[msg.sender]);
        FHE.allowSender(encCreditUtilization[msg.sender]);
        FHE.allowSender(encAccountAge[msg.sender]);
        FHE.allowSender(encNumDefaults[msg.sender]);

        emit CreditDataSubmitted(msg.sender);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Credit Score Computation — fully in encrypted domain
    //
    //  Formula (all FHE arithmetic):
    //    base = 300
    //    paymentScore  = paymentHistory * 255 / 10000        (max 255)
    //    utilScore     = (10000 - utilization) * 120 / 10000 (max 120)
    //    ageScore      = min(accountAge / 365, 10) * 15      (max 150)
    //    penalty       = numDefaults * 50
    //    score         = clamp(base + paymentScore + utilScore + ageScore - penalty, 300, 850)
    // ──────────────────────────────────────────────────────────────────

    function computeCreditScore() external {
        if (!isRegistered[msg.sender]) revert NotRegistered();

        euint32 paymentHistory = encPaymentHistory[msg.sender];
        euint32 utilization    = encCreditUtilization[msg.sender];
        euint32 accountAge     = encAccountAge[msg.sender];
        euint32 defaults       = encNumDefaults[msg.sender];
        euint32 maxBP          = FHE.asEuint32(10000);

        euint32 paymentScore = FHE.div(FHE.mul(paymentHistory, FHE.asEuint32(255)), maxBP);
        euint32 utilScore    = FHE.div(FHE.mul(FHE.sub(maxBP, utilization), FHE.asEuint32(120)), maxBP);
        euint32 accountYears = FHE.div(accountAge, FHE.asEuint32(365));
        euint32 cappedYears  = FHE.select(FHE.gt(accountYears, FHE.asEuint32(10)), FHE.asEuint32(10), accountYears);
        euint32 ageScore     = FHE.mul(cappedYears, FHE.asEuint32(15));
        euint32 penalty      = FHE.mul(defaults, FHE.asEuint32(50));

        euint32 total = FHE.add(FHE.asEuint32(300), paymentScore);
        total = FHE.add(total, utilScore);
        total = FHE.add(total, ageScore);
        total = FHE.sub(total, penalty);

        euint32 finalScore = FHE.select(
            FHE.lt(total, FHE.asEuint32(300)),
            FHE.asEuint32(300),
            FHE.select(FHE.gt(total, FHE.asEuint32(850)), FHE.asEuint32(850), total)
        );

        encCreditScore[msg.sender] = finalScore;
        hasCreditScore[msg.sender] = true;
        scoreComputedAt[msg.sender] = block.timestamp;  // NEW: record timestamp

        FHE.allowThis(finalScore);
        FHE.allowSender(finalScore);

        // NEW: append to score history (ciphertext handle only — no plaintext)
        scoreHistory[msg.sender].push(euint32.unwrap(finalScore));

        emit CreditScoreComputed(msg.sender, euint32.unwrap(finalScore));

        // NEW: notify ReputationRegistry of protocol activity
        _notifyReputationActivity(msg.sender);
    }

    // ──────────────────────────────────────────────────────────────────
    //  NEW: Encrypted Borrowing Power
    //
    //  Formula (all FHE arithmetic):
    //    riskFactor = tier-based multiplier (Prime=5000, NearPrime=3000,
    //                 Subprime=1500, DeepSubprime=500) in basis points
    //    incomeMultiplier = income * riskFactor / 10000
    //    borrowingPower   = max(incomeMultiplier - totalDebt, 0)
    //                       if score >= minBorrowScore, else 0
    //
    //  The result is stored as an encrypted euint64 and emitted as a ctHash.
    //  Third-party pools can call getBorrowingPowerCtHash() to read it.
    // ──────────────────────────────────────────────────────────────────

    function computeBorrowingPower() external {
        if (!hasCreditScore[msg.sender]) revert NoCreditData();

        euint32 score    = encCreditScore[msg.sender];
        euint64 income   = encIncome[msg.sender];
        euint64 debt     = encTotalDebt[msg.sender];
        euint64 maxBP64  = FHE.asEuint64(10000);
        euint64 zero64   = FHE.asEuint64(0);

        // Select risk factor based on encrypted score tier
        euint64 rfPrime       = FHE.asEuint64(5000);
        euint64 rfNearPrime   = FHE.asEuint64(3000);
        euint64 rfSubprime    = FHE.asEuint64(1500);
        euint64 rfDeepSub     = FHE.asEuint64(500);

        // tier selection: prime >= 740, nearPrime >= 670, subprime >= 580, else deepSub
        euint64 rf1 = FHE.select(FHE.gte(score, subprimeThreshold),  rfSubprime,  rfDeepSub);
        euint64 rf2 = FHE.select(FHE.gte(score, nearPrimeThreshold), rfNearPrime, rf1);
        euint64 rf  = FHE.select(FHE.gte(score, primeThreshold),     rfPrime,     rf2);

        // incomeMultiplier = income * riskFactor / 10000
        euint64 incomeMultiplier = FHE.div(FHE.mul(income, rf), maxBP64);

        // borrowingPower = max(incomeMultiplier - debt, 0)
        ebool canBorrow = FHE.gt(incomeMultiplier, debt);
        euint64 rawPower = FHE.sub(incomeMultiplier, debt);
        euint64 power    = FHE.select(canBorrow, rawPower, zero64);

        // Gate on minimum borrow score
        euint64 score64 = FHE.asEuint64(score);
        euint64 minBorrow64 = FHE.asEuint64(minBorrowScore);
        ebool meetsMin = FHE.gte(score64, minBorrow64);
        euint64 finalPower = FHE.select(meetsMin, power, zero64);

        encBorrowingPower[msg.sender] = finalPower;
        hasBorrowingPower[msg.sender] = true;

        FHE.allowThis(finalPower);
        FHE.allowSender(finalPower);

        emit BorrowingPowerComputed(msg.sender, euint64.unwrap(finalPower));
    }

    // ──────────────────────────────────────────────────────────────────
    //  Score Decryption
    // ──────────────────────────────────────────────────────────────────

    function requestScoreDecryption() external {
        if (!hasCreditScore[msg.sender]) revert NoCreditData();
        FHE.decrypt(encCreditScore[msg.sender]);
        emit ScoreDecryptionRequested(msg.sender, euint32.unwrap(encCreditScore[msg.sender]));
    }

    function getDecryptedScore(address _user) external view returns (uint32 score, bool isDecrypted) {
        if (!hasCreditScore[_user]) return (0, false);
        (uint256 value, bool decrypted) = FHE.getDecryptResultSafe(encCreditScore[_user]);
        return (uint32(value), decrypted);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Loan Approval — ebool-gated disbursement
    //
    //  Step 1: requestApprovalCheck() — FHE.gte(score, threshold) → ebool
    //          FHE.decrypt(ebool) triggers async decryption
    //  Step 2: resolveApprovalCheck() — polls getDecryptResultSafe(ebool)
    //  Step 3: PrivateLoanPoolV3.resolveLoanApproval() reads the result
    //          and only disburses if approved == true
    //
    //  NEW in V3: rejects stale scores (older than scoreValidityPeriod)
    // ──────────────────────────────────────────────────────────────────

    function requestApprovalCheck(
        address user,
        uint256 minScore
    ) external returns (bytes32 checkId, uint256 eboolCtHash) {
        if (!hasCreditScore[user]) revert NoCreditData();

        // NEW: enforce score freshness
        if (block.timestamp - scoreComputedAt[user] > scoreValidityPeriod) {
            revert StaleScore();
        }

        euint32 threshold    = FHE.asEuint32(minScore);
        ebool meetsThreshold = FHE.gte(encCreditScore[user], threshold);

        checkId = keccak256(abi.encodePacked(user, minScore, block.number, block.timestamp, msg.sender));

        approvalChecks[checkId] = ApprovalCheck({
            user:     user,
            minScore: minScore,
            result:   meetsThreshold,
            exists:   true,
            resolved: false,
            approved: false
        });

        FHE.allowThis(meetsThreshold);
        FHE.decrypt(meetsThreshold);

        eboolCtHash = ebool.unwrap(meetsThreshold);
        emit ApprovalCheckCreated(checkId, user, minScore, eboolCtHash);
    }

    function resolveApprovalCheck(bytes32 checkId) external returns (bool ready, bool approved) {
        ApprovalCheck storage check = approvalChecks[checkId];
        if (!check.exists) revert CheckNotFound();
        if (check.resolved) return (true, check.approved);

        (bool value, bool decrypted) = FHE.getDecryptResultSafe(check.result);
        if (!decrypted) return (false, false);

        check.resolved = true;
        check.approved = value;

        emit ApprovalCheckResolved(checkId, check.user, value);
        return (true, value);
    }

    function getApprovalCheckStatus(bytes32 checkId) external view returns (
        bool exists,
        bool resolved,
        bool approved,
        address user,
        uint256 minScore,
        uint256 eboolCtHash
    ) {
        ApprovalCheck storage check = approvalChecks[checkId];
        return (check.exists, check.resolved, check.approved, check.user, check.minScore, ebool.unwrap(check.result));
    }

    // ──────────────────────────────────────────────────────────────────
    //  NEW: Cross-Contract Score Sharing
    //
    //  Third-party protocols (e.g. a new lending pool) can be authorized
    //  by the owner. Users then call grantScoreAccess(recipient) to allow
    //  that contract to read their encrypted score handle.
    // ──────────────────────────────────────────────────────────────────

    /// @notice Authorize a contract to receive score access grants from users.
    function authorizeContract(address _contract) external onlyOwner {
        require(_contract != address(0), "Zero address");
        authorizedContracts[_contract] = true;
        emit ContractAuthorized(_contract);
    }

    /// @notice Revoke a contract's authorization.
    function revokeContract(address _contract) external onlyOwner {
        authorizedContracts[_contract] = false;
        emit ContractRevoked(_contract);
    }

    /// @notice User grants an authorized contract read access to their encrypted score.
    /// @dev The recipient can then call getEncryptedScore() and use the handle in FHE ops.
    function grantScoreAccess(address recipient) external {
        if (!hasCreditScore[msg.sender]) revert NoCreditData();
        if (!authorizedContracts[recipient]) revert NotAuthorizedContract();
        FHE.allow(encCreditScore[msg.sender], recipient);
        emit ScoreAccessGranted(msg.sender, recipient);
    }

    /// @notice Get the encrypted score handle (requires prior grantScoreAccess or allowSender).
    function getEncryptedScore(address user) external view returns (euint32) {
        if (!hasCreditScore[user]) revert NoCreditData();
        return encCreditScore[user];
    }

    /// @notice Get the encrypted borrowing power handle.
    function getBorrowingPowerCtHash(address user) external view returns (uint256) {
        if (!hasBorrowingPower[user]) revert NoCreditData();
        return euint64.unwrap(encBorrowingPower[user]);
    }

    // ──────────────────────────────────────────────────────────────────
    //  NEW: Score History
    // ──────────────────────────────────────────────────────────────────

    /// @notice Get the number of score computations for a user.
    function getScoreHistoryLength(address user) external view returns (uint256) {
        return scoreHistory[user].length;
    }

    /// @notice Get a historical score ciphertext handle by index.
    /// @dev The handle can be unsealed off-chain by the user via cofhejs.unseal().
    function getScoreHistoryAt(address user, uint256 index) external view returns (uint256) {
        return scoreHistory[user][index];
    }

    // ──────────────────────────────────────────────────────────────────
    //  NEW: Reputation Hook
    // ──────────────────────────────────────────────────────────────────

    /// @dev Called internally after computeCreditScore() to notify the
    ///      ReputationRegistry of protocol activity. Uses trivial encryption
    ///      (FHE.asEuint32) because the score value (8000 = 80%) is not sensitive —
    ///      it represents "user computed a score" not the score itself.
    function _notifyReputationActivity(address user) internal {
        if (reputationRegistry == address(0)) return;

        // Trivially encrypt a high ProtocolInteraction score (8000 bps = 80%)
        // to signal that the user is actively using the protocol.
        // This is NOT the credit score — it's a reputation signal.
        // The ReputationRegistry will clamp it to [0, 10000].
        try IReputationRegistryMinimal(reputationRegistry).notifyActivity(user) {
            // success — reputation updated
        } catch {
            // Silently ignore — reputation registry failure must not block scoring
        }
    }

    // ──────────────────────────────────────────────────────────────────
    //  Read-Only
    // ──────────────────────────────────────────────────────────────────

    function getUserCount() external view returns (uint256) {
        return registeredUsers.length;
    }

    function isScoreStale(address user) external view returns (bool) {
        if (!hasCreditScore[user]) return true;
        return block.timestamp - scoreComputedAt[user] > scoreValidityPeriod;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────────────────────────

    function setScoreValidityPeriod(uint256 _period) external onlyOwner {
        require(_period >= 1 days, "Too short");
        scoreValidityPeriod = _period;
    }

    function setReputationRegistry(address _registry) external onlyOwner {
        reputationRegistry = _registry;
        emit ReputationRegistrySet(_registry);
    }

    function updateThresholds(
        uint256 _prime,
        uint256 _nearPrime,
        uint256 _subprime,
        uint256 _minBorrow
    ) external onlyOwner {
        primeThreshold     = FHE.asEuint32(_prime);
        nearPrimeThreshold = FHE.asEuint32(_nearPrime);
        subprimeThreshold  = FHE.asEuint32(_subprime);
        minBorrowScore     = FHE.asEuint32(_minBorrow);

        FHE.allowThis(primeThreshold);
        FHE.allowThis(nearPrimeThreshold);
        FHE.allowThis(subprimeThreshold);
        FHE.allowThis(minBorrowScore);
    }
}

/// @dev Minimal interface for the reputation hook — avoids importing the full registry.
interface IReputationRegistryMinimal {
    /// @notice Called by the credit engine to signal protocol activity.
    ///         The registry decides how to update reputation factors.
    function notifyActivity(address user) external;
}
