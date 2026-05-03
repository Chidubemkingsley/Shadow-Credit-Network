// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title EncryptedCreditEngineV2
/// @notice Privacy-preserving credit scoring engine using CoFHE.
///
/// @dev Decryption pattern used (cofhe-contracts v0.0.13):
///      1. FHE.decrypt(ctHash)          - triggers async decryption on-chain
///      2. FHE.getDecryptResultSafe()   - poll until decrypted == true
///
///      NOTE: The Fhenix docs describe a newer pattern (allowPublic + publishDecryptResult
///      with Threshold Network signatures). That API is not yet in cofhe-contracts v0.0.13.
///      When upgrading, replace FHE.decrypt() calls with:
///        FHE.allowPublic(ctHash)
///        // off-chain: client.decryptForTx(ctHash).withoutPermit().execute()
///        // on-chain:  FHE.publishDecryptResult(ctHash, plaintext, signature)
///
/// Loan approval flow (ebool-gated disbursement):
///   1. requestApprovalCheck()  — creates ebool via FHE.gte(), calls FHE.decrypt(ebool)
///   2. resolveApprovalCheck()  — polls FHE.getDecryptResultSafe(ebool); stores result
///   3. PrivateLoanPoolV2 calls resolveLoanApproval() which calls resolveApprovalCheck()
///      and only disburses if the ebool resolved to true.
contract EncryptedCreditEngineV2 is Ownable {

    // ──────────────────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────────────────

    event UserRegistered(address indexed user);
    event CreditDataSubmitted(address indexed user);
    event CreditScoreComputed(address indexed user);
    event ScoreDecryptionRequested(address indexed user, uint256 ctHash);
    event ApprovalCheckCreated(bytes32 indexed checkId, address indexed user, uint256 minScore, uint256 eboolCtHash);
    event ApprovalCheckResolved(bytes32 indexed checkId, address indexed user, bool approved);

    // ──────────────────────────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error NoCreditData();
    error ScoreNotDecrypted();
    error CheckNotFound();

    // ──────────────────────────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────────────────────────

    // Encrypted credit profiles — stored as separate mappings for gas efficiency
    mapping(address => euint64) private encIncome;
    mapping(address => euint64) private encTotalDebt;
    mapping(address => euint32) private encPaymentHistory;
    mapping(address => euint32) private encCreditUtilization;
    mapping(address => euint32) private encAccountAge;
    mapping(address => euint32) private encNumDefaults;

    // Computed scores (encrypted)
    mapping(address => euint32) private encCreditScore;
    mapping(address => bool) public hasCreditScore;
    mapping(address => bool) public isRegistered;

    // ── Approval checks ──────────────────────────────────────────────
    // Stores the ebool result of an encrypted score comparison.
    // FHE.decrypt(ebool) is called immediately; resolveApprovalCheck()
    // polls getDecryptResultSafe() until the result is ready.
    struct ApprovalCheck {
        address user;
        uint256 minScore;
        ebool   result;         // encrypted comparison result (score >= threshold)
        bool    exists;
        bool    resolved;       // true once getDecryptResultSafe returned decrypted=true
        bool    approved;       // plaintext result, set on resolution
    }

    mapping(bytes32 => ApprovalCheck) private approvalChecks;

    // Thresholds (trivially encrypted — values are public knowledge)
    euint32 public primeThreshold;
    euint32 public nearPrimeThreshold;
    euint32 public subprimeThreshold;

    address[] public registeredUsers;

    // ──────────────────────────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor(address _owner) Ownable(_owner) {
        primeThreshold     = FHE.asEuint32(740);
        nearPrimeThreshold = FHE.asEuint32(670);
        subprimeThreshold  = FHE.asEuint32(580);

        FHE.allowThis(primeThreshold);
        FHE.allowThis(nearPrimeThreshold);
        FHE.allowThis(subprimeThreshold);
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
    // ──────────────────────────────────────────────────────────────────

    /// @notice Submit encrypted credit data.
    /// @dev Each parameter must be a real ciphertext produced by:
    ///        cofheClient.encryptInputs([Encryptable.uint64(value), ...]).execute()
    ///      The SDK returns EncryptedItemInput objects that map directly to InEuint* structs.
    ///      Do NOT pass trivially-encrypted values (FHE.asEuint64(plaintext)) from the client —
    ///      those are not private. Only InEuint* calldata from the SDK carries a ZK proof.
    function submitCreditData(
        InEuint64 calldata _income,
        InEuint64 calldata _totalDebt,
        InEuint32 calldata _paymentHistory,
        InEuint32 calldata _creditUtilization,
        InEuint32 calldata _accountAge,
        InEuint32 calldata _numDefaults
    ) external {
        if (!isRegistered[msg.sender]) revert NotRegistered();

        // FHE.asEuint*(InEuint*) verifies the CoFHE SDK ZK proof and registers
        // the ciphertext with the ACL in a single operation.
        encIncome[msg.sender]            = FHE.asEuint64(_income);
        encTotalDebt[msg.sender]         = FHE.asEuint64(_totalDebt);
        encPaymentHistory[msg.sender]    = FHE.asEuint32(_paymentHistory);
        encCreditUtilization[msg.sender] = FHE.asEuint32(_creditUtilization);
        encAccountAge[msg.sender]        = FHE.asEuint32(_accountAge);
        encNumDefaults[msg.sender]       = FHE.asEuint32(_numDefaults);

        // Grant this contract access for future FHE computations
        FHE.allowThis(encIncome[msg.sender]);
        FHE.allowThis(encTotalDebt[msg.sender]);
        FHE.allowThis(encPaymentHistory[msg.sender]);
        FHE.allowThis(encCreditUtilization[msg.sender]);
        FHE.allowThis(encAccountAge[msg.sender]);
        FHE.allowThis(encNumDefaults[msg.sender]);

        // Grant sender read access to their own encrypted data
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
    // ──────────────────────────────────────────────────────────────────

    /// @notice Compute credit score entirely in the encrypted domain.
    /// @dev Score formula (all FHE arithmetic, no plaintext exposed):
    ///      base = 300
    ///      paymentScore  = paymentHistory * 255 / 10000        (max 255)
    ///      utilScore     = (10000 - utilization) * 120 / 10000 (max 120)
    ///      ageScore      = min(accountAge / 365, 10) * 15      (max 150)
    ///      penalty       = numDefaults * 50
    ///      score         = clamp(base + paymentScore + utilScore + ageScore - penalty, 300, 850)
    function computeCreditScore() external {
        if (!isRegistered[msg.sender]) revert NotRegistered();

        euint32 paymentHistory = encPaymentHistory[msg.sender];
        euint32 utilization    = encCreditUtilization[msg.sender];
        euint32 accountAge     = encAccountAge[msg.sender];
        euint32 defaults       = encNumDefaults[msg.sender];

        euint32 maxBP = FHE.asEuint32(10000);

        // Payment score: (paymentHistory / 10000) * 255
        euint32 paymentScore = FHE.div(FHE.mul(paymentHistory, FHE.asEuint32(255)), maxBP);

        // Utilization score (inverted): ((10000 - utilization) / 10000) * 120
        euint32 utilInv   = FHE.sub(maxBP, utilization);
        euint32 utilScore = FHE.div(FHE.mul(utilInv, FHE.asEuint32(120)), maxBP);

        // Age score (capped at 10 years): min(accountAge / 365, 10) * 15
        euint32 accountYears = FHE.div(accountAge, FHE.asEuint32(365));
        euint32 cappedYears  = FHE.select(FHE.gt(accountYears, FHE.asEuint32(10)), FHE.asEuint32(10), accountYears);
        euint32 ageScore     = FHE.mul(cappedYears, FHE.asEuint32(15));

        // Default penalty: numDefaults * 50
        euint32 penalty = FHE.mul(defaults, FHE.asEuint32(50));

        // Aggregate and clamp to [300, 850]
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

        FHE.allowThis(finalScore);
        FHE.allowSender(finalScore);

        emit CreditScoreComputed(msg.sender);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Score Decryption (current pattern: FHE.decrypt + getDecryptResultSafe)
    // ──────────────────────────────────────────────────────────────────

    /// @notice Request async decryption of the caller's credit score.
    function requestScoreDecryption() external {
        if (!hasCreditScore[msg.sender]) revert NoCreditData();
        FHE.decrypt(encCreditScore[msg.sender]);
        emit ScoreDecryptionRequested(msg.sender, euint32.unwrap(encCreditScore[msg.sender]));
    }

    /// @notice Read the decrypted score once available.
    /// @return score       Plaintext score (0 if not yet decrypted).
    /// @return isDecrypted Whether decryption has completed.
    function getDecryptedScore(address _user) external view returns (uint32 score, bool isDecrypted) {
        if (!hasCreditScore[_user]) return (0, false);
        (uint256 value, bool decrypted) = FHE.getDecryptResultSafe(encCreditScore[_user]);
        return (uint32(value), decrypted);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Loan Approval — ebool-gated disbursement
    //
    //  Step 1 (on-chain):  requestApprovalCheck() — creates ebool, calls FHE.decrypt(ebool)
    //  Step 2 (on-chain):  resolveApprovalCheck() — polls getDecryptResultSafe, stores result
    //  Step 3 (on-chain):  PrivateLoanPoolV2.resolveLoanApproval() reads the result
    // ──────────────────────────────────────────────────────────────────

    /// @notice Create an encrypted credit approval check and trigger async decryption.
    /// @param user     The borrower whose score is being checked.
    /// @param minScore The minimum score threshold (plaintext — threshold is public knowledge).
    /// @return checkId     Unique identifier for this approval check.
    /// @return eboolCtHash The ciphertext handle of the ebool (for off-chain monitoring).
    function requestApprovalCheck(
        address user,
        uint256 minScore
    ) external returns (bytes32 checkId, uint256 eboolCtHash) {
        if (!hasCreditScore[user]) revert NoCreditData();

        // Encrypted comparison: score >= threshold (all in FHE domain)
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

        // Grant this contract access to the ebool for future getDecryptResultSafe calls
        FHE.allowThis(meetsThreshold);

        // Trigger async decryption — result will be available via getDecryptResultSafe
        FHE.decrypt(meetsThreshold);

        eboolCtHash = ebool.unwrap(meetsThreshold);
        emit ApprovalCheckCreated(checkId, user, minScore, eboolCtHash);
    }

    /// @notice Poll the decryption result and store it once ready.
    /// @dev This is permissionless — anyone can call it to advance the state.
    ///      Returns (false, false) if decryption is not yet complete.
    /// @return ready    True once the ebool has been decrypted.
    /// @return approved The plaintext approval decision (only valid when ready=true).
    function resolveApprovalCheck(bytes32 checkId) external returns (bool ready, bool approved) {
        ApprovalCheck storage check = approvalChecks[checkId];
        if (!check.exists) revert CheckNotFound();

        // Already resolved — return cached result
        if (check.resolved) return (true, check.approved);

        // Poll the FHE decryption result
        (bool value, bool decrypted) = FHE.getDecryptResultSafe(check.result);
        if (!decrypted) return (false, false);

        // Store the result
        check.resolved = true;
        check.approved = value;

        emit ApprovalCheckResolved(checkId, check.user, value);
        return (true, value);
    }

    /// @notice View-only version — does not write state.
    function getApprovalCheckStatus(bytes32 checkId) external view returns (
        bool exists,
        bool resolved,
        bool approved,
        address user,
        uint256 minScore,
        uint256 eboolCtHash
    ) {
        ApprovalCheck storage check = approvalChecks[checkId];
        return (
            check.exists,
            check.resolved,
            check.approved,
            check.user,
            check.minScore,
            ebool.unwrap(check.result)
        );
    }

    // ──────────────────────────────────────────────────────────────────
    //  Read-Only
    // ──────────────────────────────────────────────────────────────────

    /// @notice Get the encrypted score handle (for off-chain unsealing via cofhejs.unseal).
    function getEncryptedScore(address user) external view returns (euint32) {
        if (!hasCreditScore[user]) revert NoCreditData();
        return encCreditScore[user];
    }

    function getUserCount() external view returns (uint256) {
        return registeredUsers.length;
    }
}
