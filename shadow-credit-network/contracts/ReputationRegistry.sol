// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ReputationRegistry
/// @notice Privacy-preserving on-chain reputation tracking using Fully Homomorphic Encryption.
/// @dev Tracks multiple reputation factors (staking, governance, transaction reliability,
///      attestations) as encrypted values. Supports attestation by whitelisted verifiers,
///      time-based decay, and integration with EncryptedCreditEngine.
contract ReputationRegistry is Ownable {

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event UserRegistered(address indexed user);
    event ReputationUpdated(address indexed user, ReputationFactor factor, uint256 scoreHash);
    event AttestationSubmitted(address indexed user, address indexed verifier, AttestationType attestationType);
    event AttestationRevoked(address indexed user, address indexed verifier, AttestationType attestationType);
    event VerifierAdded(address indexed verifier);
    event VerifierRemoved(address indexed verifier);
    event DecayApplied(address indexed user, uint256 decayedFactors);
    event ReputationDecrypted(address indexed user, uint256 compositeScore);
    event IntegrationContractSet(address indexed integration);
    event IntegrationContractRemoved(address indexed integration);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error NotVerifier();
    error AlreadyVerifier();
    error NotAuthorized();
    error InvalidFactor();
    error DecayNotReady();
    error AlreadyAttested();
    error AttestationNotFound();
    error NotIntegrationContract();
    error ZeroAddress();

    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    /// @notice Reputation factors tracked by the registry
    enum ReputationFactor {
        TransactionReliability,  // 0 — On-time payments, successful txns
        StakingHistory,          // 1 — Duration and amount staked
        GovernanceParticipation, // 2 — Voting, proposals
        ProtocolInteraction,     // 3 — Depth of protocol usage
        SocialVerification,      // 4 — KYC/social attestations
        DefaultHistory           // 5 — Inverse factor: defaults reduce score
    }

    /// @notice Types of attestations verifiers can issue
    enum AttestationType {
        Identity,         // KYC / identity verification
        CreditWorthiness, // External credit attestation
        StakingProof,     // Verified staking history
        SocialReputation, // Social graph reputation
        ProtocolLoyalty   // Long-term protocol engagement
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    /// @notice Individual reputation factor score
    struct FactorScore {
        euint32 score;               // Factor score 0-10000 (encrypted, basis points)
        uint256 lastUpdated;         // Timestamp of last update (plaintext)
    }

    /// @notice Complete user reputation profile
    struct ReputationProfile {
        FactorScore[6] factors;      // Array of factor scores (fixed size for storage efficiency)
        euint32 compositeScore;      // Weighted composite score 0-10000 (encrypted)
        uint256 registeredAt;        // Registration timestamp
        uint256 lastActivityAt;      // Last activity timestamp
        bool isActive;               // Whether profile is active
    }

    /// @notice Attestation from a verified verifier
    struct Attestation {
        address verifier;
        AttestationType attestationType;
        euint32 attestationScore;    // Verifier-assigned score 0-10000 (encrypted)
        uint256 issuedAt;
        bool isActive;
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @notice User reputation profiles
    mapping(address => ReputationProfile) private profiles;

    /// @notice Attestations per user per verifier per type
    mapping(address => mapping(address => mapping(uint256 => Attestation))) private attestations;

    /// @notice List of attestation types per user per verifier (for enumeration)
    mapping(address => mapping(address => uint256[])) private userAttestationTypes;

    /// @notice Whitelisted verifier addresses
    mapping(address => bool) public verifiers;

    /// @notice List of all verifiers
    address[] private verifierList;

    /// @notice Registered users
    address[] private registeredUsers;
    mapping(address => bool) private isUserIndex;

    /// @notice Authorized integration contracts (e.g., EncryptedCreditEngine)
    mapping(address => bool) public integrationContracts;

    /// @notice Decay parameters
    uint256 public decayInterval;      // Seconds between decay applications
    euint32 public decayRate;          // Decay rate in basis points per interval (encrypted)

    /// @notice Factor weights for composite score (basis points, must sum to 10000)
    mapping(uint256 => euint32) private factorWeights;

    /// @notice Minimum attestations required for full reputation
    uint256 public minAttestations;

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(
        address _owner,
        uint256 _decayInterval,
        uint256 _minAttestations
    ) Ownable(_owner) {
        require(_owner != address(0), "Invalid owner");

        decayInterval = _decayInterval > 0 ? _decayInterval : 90 days;
        minAttestations = _minAttestations > 0 ? _minAttestations : 2;

        // Initialize decay rate: 1% per interval (100 bps)
        decayRate = FHE.asEuint32(100);
        FHE.allowThis(decayRate);

        // Initialize factor weights (basis points)
        // TransactionReliability: 30% (3000 bps)
        // StakingHistory: 20% (2000 bps)
        // GovernanceParticipation: 15% (1500 bps)
        // ProtocolInteraction: 15% (1500 bps)
        // SocialVerification: 10% (1000 bps)
        // DefaultHistory: 10% (1000 bps, inverse penalty)
        _initializeWeights();
    }

    function _initializeWeights() internal {
        factorWeights[uint256(ReputationFactor.TransactionReliability)] = FHE.asEuint32(3000);
        factorWeights[uint256(ReputationFactor.StakingHistory)] = FHE.asEuint32(2000);
        factorWeights[uint256(ReputationFactor.GovernanceParticipation)] = FHE.asEuint32(1500);
        factorWeights[uint256(ReputationFactor.ProtocolInteraction)] = FHE.asEuint32(1500);
        factorWeights[uint256(ReputationFactor.SocialVerification)] = FHE.asEuint32(1000);
        factorWeights[uint256(ReputationFactor.DefaultHistory)] = FHE.asEuint32(1000);

        for (uint256 i = 0; i < 6; i++) {
            FHE.allowThis(factorWeights[i]);
        }
    }

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyRegistered() {
        if (!profiles[msg.sender].isActive) revert NotRegistered();
        _;
    }

    modifier onlyVerifier() {
        if (!verifiers[msg.sender]) revert NotVerifier();
        _;
    }

    modifier onlyIntegration() {
        if (!integrationContracts[msg.sender]) revert NotIntegrationContract();
        _;
    }

    modifier onlyRegisteredOrIntegration(address user) {
        if (!profiles[user].isActive && !integrationContracts[msg.sender]) revert NotRegistered();
        _;
    }

    // ──────────────────────────────────────────────
    //  Registration
    // ──────────────────────────────────────────────

    /// @notice Register the caller in the reputation registry
    function register() external {
        if (profiles[msg.sender].isActive) revert AlreadyRegistered();

        ReputationProfile storage profile = profiles[msg.sender];
        profile.compositeScore = FHE.asEuint32(5000); // Start at 50% (neutral)
        profile.registeredAt = block.timestamp;
        profile.lastActivityAt = block.timestamp;
        profile.isActive = true;

        // Initialize all factor scores at 50% (neutral)
        for (uint256 i = 0; i < 6; i++) {
            profile.factors[i].score = FHE.asEuint32(5000);
            profile.factors[i].lastUpdated = block.timestamp;
            FHE.allowThis(profile.factors[i].score);
            FHE.allowSender(profile.factors[i].score);
        }

        FHE.allowThis(profile.compositeScore);
        FHE.allowSender(profile.compositeScore);

        if (!isUserIndex[msg.sender]) {
            registeredUsers.push(msg.sender);
            isUserIndex[msg.sender] = true;
        }

        emit UserRegistered(msg.sender);
    }

    // ──────────────────────────────────────────────
    //  Reputation Updates
    // ──────────────────────────────────────────────

    /// @notice Update a specific reputation factor (only by integration contracts)
    /// @param _user The user whose reputation to update
    /// @param _factor The reputation factor to update
    /// @param _newScore Encrypted new score value (0-10000 basis points)
    function updateReputation(
        address _user,
        ReputationFactor _factor,
        InEuint32 calldata _newScore
    ) external onlyIntegration onlyRegisteredOrIntegration(_user) {
        euint32 newScore = FHE.asEuint32(_newScore);
        uint256 factorIndex = uint256(_factor);

        // Clamp score to [0, 10000]
        euint32 maxBP = FHE.asEuint32(10000);
        euint32 clampedScore = FHE.select(FHE.gt(newScore, maxBP), maxBP, newScore);

        profiles[_user].factors[factorIndex].score = clampedScore;
        profiles[_user].factors[factorIndex].lastUpdated = block.timestamp;
        profiles[_user].lastActivityAt = block.timestamp;

        FHE.allowThis(clampedScore);
        FHE.allowSender(clampedScore);
        FHE.allow(clampedScore, _user);

        // Recompute composite score
        _recomputeCompositeScore(_user);

        emit ReputationUpdated(_user, _factor, euint32.unwrap(clampedScore));
    }

    /// @notice Batch update multiple reputation factors
    function batchUpdateReputation(
        address _user,
        ReputationFactor[] calldata _factors,
        InEuint32[] calldata _scores
    ) external onlyIntegration onlyRegisteredOrIntegration(_user) {
        require(_factors.length == _scores.length, "Length mismatch");

        euint32 maxBP = FHE.asEuint32(10000);

        for (uint256 i = 0; i < _factors.length; i++) {
            euint32 newScore = FHE.asEuint32(_scores[i]);
            uint256 factorIndex = uint256(_factors[i]);

            euint32 clampedScore = FHE.select(FHE.gt(newScore, maxBP), maxBP, newScore);

            profiles[_user].factors[factorIndex].score = clampedScore;
            profiles[_user].factors[factorIndex].lastUpdated = block.timestamp;

            FHE.allowThis(clampedScore);
            FHE.allowSender(clampedScore);
            FHE.allow(clampedScore, _user);

            emit ReputationUpdated(_user, _factors[i], euint32.unwrap(clampedScore));
        }

        profiles[_user].lastActivityAt = block.timestamp;
        _recomputeCompositeScore(_user);
    }

    // ──────────────────────────────────────────────
    //  Composite Score Computation
    // ──────────────────────────────────────────────

    /// @notice Recompute the weighted composite score from all factors
    /// @dev Formula: composite = Σ(factor_score × factor_weight) / 10000
    ///      DefaultHistory is inverted: (10000 - score) × weight / 10000
    function _recomputeCompositeScore(address _user) internal {
        ReputationProfile storage profile = profiles[_user];

        euint32 composite = FHE.asEuint32(0);
        euint32 maxBP = FHE.asEuint32(10000);

        for (uint256 i = 0; i < 5; i++) {
            // Regular factors: score * weight / 10000
            euint32 weighted = FHE.div(
                FHE.mul(profile.factors[i].score, factorWeights[i]),
                maxBP
            );
            composite = FHE.add(composite, weighted);
        }

        // DefaultHistory (index 5): invert the score (lower defaults = better)
        euint32 invertedDefault = FHE.sub(maxBP, profile.factors[5].score);
        euint32 defaultWeighted = FHE.div(
            FHE.mul(invertedDefault, factorWeights[5]),
            maxBP
        );
        composite = FHE.add(composite, defaultWeighted);

        // Apply attestation bonus: +5% per active attestation up to +25%
        uint256 attestationCount = _getActiveAttestationCount(_user);
        if (attestationCount > 0) {
            uint256 bonusBps = attestationCount * 500; // 500 bps = 5% per attestation
            if (bonusBps > 2500) bonusBps = 2500; // Cap at 25%
            euint32 bonus = FHE.asEuint32(uint32(bonusBps));
            composite = FHE.add(composite, bonus);
        }

        // Clamp composite to [0, 10000]
        euint32 clamped = FHE.select(FHE.gt(composite, maxBP), maxBP, composite);

        profile.compositeScore = clamped;
        FHE.allowThis(clamped);
        FHE.allowSender(clamped);
        FHE.allow(clamped, _user);
    }

    function _getActiveAttestationCount(address _user) internal view returns (uint256 count) {
        for (uint256 v = 0; v < verifierList.length; v++) {
            uint256[] memory types = userAttestationTypes[_user][verifierList[v]];
            for (uint256 t = 0; t < types.length; t++) {
                if (attestations[_user][verifierList[v]][types[t]].isActive) {
                    count++;
                }
            }
        }
    }

    // ──────────────────────────────────────────────
    //  Attestations
    // ──────────────────────────────────────────────

    /// @notice Submit an attestation for a user (verifiers only)
    /// @param _user The user being attested
    /// @param _type The type of attestation
    /// @param _score Encrypted attestation score (0-10000)
    function submitAttestation(
        address _user,
        AttestationType _type,
        InEuint32 calldata _score
    ) external onlyVerifier {
        if (!profiles[_user].isActive) revert NotRegistered();

        uint256 typeIndex = uint256(_type);
        if (attestations[_user][msg.sender][typeIndex].isActive) revert AlreadyAttested();

        euint32 score = FHE.asEuint32(_score);

        // Clamp to [0, 10000]
        euint32 maxBP = FHE.asEuint32(10000);
        euint32 clampedScore = FHE.select(FHE.gt(score, maxBP), maxBP, score);

        attestations[_user][msg.sender][typeIndex] = Attestation({
            verifier: msg.sender,
            attestationType: _type,
            attestationScore: clampedScore,
            issuedAt: block.timestamp,
            isActive: true
        });

        userAttestationTypes[_user][msg.sender].push(typeIndex);

        FHE.allowThis(clampedScore);
        FHE.allow(clampedScore, _user);

        // Recompute composite
        profiles[_user].lastActivityAt = block.timestamp;
        _recomputeCompositeScore(_user);

        emit AttestationSubmitted(_user, msg.sender, _type);
    }

    /// @notice Revoke an attestation (verifiers only)
    function revokeAttestation(
        address _user,
        AttestationType _type
    ) external onlyVerifier {
        uint256 typeIndex = uint256(_type);
        if (!attestations[_user][msg.sender][typeIndex].isActive) revert AttestationNotFound();

        attestations[_user][msg.sender][typeIndex].isActive = false;

        // Recompute composite
        _recomputeCompositeScore(_user);

        emit AttestationRevoked(_user, msg.sender, _type);
    }

    // ──────────────────────────────────────────────
    //  Decay Mechanism
    // ──────────────────────────────────────────────

    /// @notice Apply time-based decay to a user's reputation factors
    /// @dev Each factor decays by `decayRate` bps per `decayInterval` of inactivity
    function applyDecay(address _user) external {
        if (!profiles[_user].isActive) revert NotRegistered();

        uint256 timeSinceActivity = block.timestamp - profiles[_user].lastActivityAt;
        if (timeSinceActivity < decayInterval) revert DecayNotReady();

        uint256 decayPeriods = timeSinceActivity / decayInterval;
        if (decayPeriods == 0) revert DecayNotReady();

        ReputationProfile storage profile = profiles[_user];
        euint32 maxBP = FHE.asEuint32(10000);
        uint256 decayedFactors = 0;

        for (uint256 i = 0; i < 6; i++) {
            uint256 factorAge = block.timestamp - profile.factors[i].lastUpdated;
            if (factorAge >= decayInterval) {
                // Apply decay: score = score * (10000 - decayRate * periods) / 10000
                euint32 decayMultiplier = FHE.sub(maxBP, FHE.mul(decayRate, FHE.asEuint32(uint32(decayPeriods))));
                // Floor the multiplier at 0
                euint32 safeMultiplier = FHE.select(FHE.gt(decayMultiplier, maxBP), FHE.asEuint32(0), decayMultiplier);

                profile.factors[i].score = FHE.div(
                    FHE.mul(profile.factors[i].score, safeMultiplier),
                    maxBP
                );

                FHE.allowThis(profile.factors[i].score);
                FHE.allowSender(profile.factors[i].score);
                FHE.allow(profile.factors[i].score, _user);

                profile.factors[i].lastUpdated = block.timestamp;
                decayedFactors++;
            }
        }

        if (decayedFactors > 0) {
            _recomputeCompositeScore(_user);
            emit DecayApplied(_user, decayedFactors);
        }
    }

    // ──────────────────────────────────────────────
    //  Decryption
    // ──────────────────────────────────────────────

    /// @notice Request decryption of composite reputation score
    function requestDecryption() external onlyRegistered {
        FHE.decrypt(profiles[msg.sender].compositeScore);
    }

    /// @notice Get the decrypted composite score
    function getDecryptedScore() external view returns (uint32 score) {
        (uint256 value, bool decrypted) = FHE.getDecryptResultSafe(profiles[msg.sender].compositeScore);
        if (!decrypted) revert("Not decrypted");
        return uint32(value);
    }

    /// @notice Safe getter for decrypted score
    function getDecryptedScoreSafe() external view returns (uint32 score, bool isDecrypted) {
        (uint256 value, bool decrypted) = FHE.getDecryptResultSafe(profiles[msg.sender].compositeScore);
        return (uint32(value), decrypted);
    }

    // ──────────────────────────────────────────────
    //  Read-Only Queries
    // ──────────────────────────────────────────────

    /// @notice Get encrypted composite reputation score for a user
    function getCompositeScore(address _user) external view returns (euint32) {
        if (!profiles[_user].isActive) revert NotRegistered();
        return profiles[_user].compositeScore;
    }

    /// @notice Get encrypted score for a specific reputation factor
    function getFactorScore(address _user, ReputationFactor _factor) external view returns (euint32) {
        if (!profiles[_user].isActive) revert NotRegistered();
        return profiles[_user].factors[uint256(_factor)].score;
    }

    /// @notice Get plaintext metadata for a factor (last updated timestamp)
    function getFactorMetadata(address _user, ReputationFactor _factor) external view returns (uint256 lastUpdated) {
        return profiles[_user].factors[uint256(_factor)].lastUpdated;
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

    /// @notice Check if an attestation is active
    function isAttestationActive(
        address _user,
        address _verifier,
        AttestationType _type
    ) external view returns (bool) {
        return attestations[_user][_verifier][uint256(_type)].isActive;
    }

    /// @notice Get the number of active attestations for a user
    function getActiveAttestationCount(address _user) external view returns (uint256) {
        return _getActiveAttestationCount(_user);
    }

    /// @notice Get the registration timestamp for a user
    function getRegisteredAt(address _user) external view returns (uint256) {
        return profiles[_user].registeredAt;
    }

    /// @notice Get the last activity timestamp for a user
    function getLastActivityAt(address _user) external view returns (uint256) {
        return profiles[_user].lastActivityAt;
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    /// @notice Add a verifier address
    function addVerifier(address _verifier) external onlyOwner {
        if (_verifier == address(0)) revert ZeroAddress();
        if (verifiers[_verifier]) revert AlreadyVerifier();

        verifiers[_verifier] = true;
        verifierList.push(_verifier);

        emit VerifierAdded(_verifier);
    }

    /// @notice Remove a verifier address
    function removeVerifier(address _verifier) external onlyOwner {
        if (!verifiers[_verifier]) revert NotVerifier();

        verifiers[_verifier] = false;

        // Remove from list
        for (uint256 i = 0; i < verifierList.length; i++) {
            if (verifierList[i] == _verifier) {
                verifierList[i] = verifierList[verifierList.length - 1];
                verifierList.pop();
                break;
            }
        }

        emit VerifierRemoved(_verifier);
    }

    /// @notice Register an integration contract (e.g., EncryptedCreditEngine)
    function setIntegrationContract(address _integration) external onlyOwner {
        if (_integration == address(0)) revert ZeroAddress();
        integrationContracts[_integration] = true;
        emit IntegrationContractSet(_integration);
    }

    /// @notice Remove an integration contract
    function removeIntegrationContract(address _integration) external onlyOwner {
        integrationContracts[_integration] = false;
        emit IntegrationContractRemoved(_integration);
    }

    /// @notice Update decay parameters
    function updateDecayParams(
        uint256 _newInterval,
        InEuint32 calldata _newRate
    ) external onlyOwner {
        if (_newInterval > 0) {
            decayInterval = _newInterval;
        }
        euint32 newRate = FHE.asEuint32(_newRate);
        decayRate = newRate;
        FHE.allowThis(decayRate);
    }

    /// @notice Update factor weights (must sum to 10000 bps)
    function updateFactorWeights(InEuint32[6] calldata _weights) external onlyOwner {
        euint32 totalWeight = FHE.asEuint32(0);

        for (uint256 i = 0; i < 6; i++) {
            factorWeights[i] = FHE.asEuint32(_weights[i]);
            FHE.allowThis(factorWeights[i]);
            totalWeight = FHE.add(totalWeight, factorWeights[i]);
        }

        // Validate total is 10000 (encrypted check)
        euint32 expected = FHE.asEuint32(10000);
        FHE.eq(totalWeight, expected);
    }

    /// @notice Update minimum attestations required
    function setMinAttestations(uint256 _minAttestations) external onlyOwner {
        minAttestations = _minAttestations;
    }

    /// @notice Get the verifier list length
    function getVerifierCount() external view returns (uint256) {
        return verifierList.length;
    }

    /// @notice Get a verifier by index
    function getVerifierAtIndex(uint256 _index) external view returns (address) {
        return verifierList[_index];
    }

    // ──────────────────────────────────────────────
    //  Wave 3: Protocol Activity Hook
    //
    //  Called by EncryptedCreditEngineV3, PrivateLoanPoolV3, and CreditDelegationV2
    //  after protocol events (score computation, repayment, default).
    //  Updates ProtocolInteraction factor with a trivially-encrypted high score
    //  to signal active protocol participation.
    //
    //  Only callable by registered integration contracts.
    //  Silently no-ops if the user is not registered in the reputation system.
    // ──────────────────────────────────────────────

    event ActivityNotified(address indexed user, address indexed caller);

    /// @notice Notify the registry that a user performed a protocol action.
    /// @dev Uses trivial encryption (FHE.asEuint32) for the activity score.
    ///      This is intentional — the value (8000 bps = 80% activity) is not
    ///      sensitive. Only the composite score (which blends all factors) is private.
    function notifyActivity(address _user) external {
        // Only authorized integration contracts can call this
        if (!integrationContracts[msg.sender]) revert NotIntegrationContract();

        // Silently skip if user is not registered
        if (!profiles[_user].isActive) return;

        // Update ProtocolInteraction factor (index 3) with a high activity score
        uint256 factorIndex = uint256(ReputationFactor.ProtocolInteraction);
        euint32 activityScore = FHE.asEuint32(8000); // 80% — signals active use

        profiles[_user].factors[factorIndex].score = activityScore;
        profiles[_user].factors[factorIndex].lastUpdated = block.timestamp;
        profiles[_user].lastActivityAt = block.timestamp;

        FHE.allowThis(activityScore);
        FHE.allow(activityScore, _user);

        _recomputeCompositeScore(_user);

        emit ActivityNotified(_user, msg.sender);
        emit ReputationUpdated(_user, ReputationFactor.ProtocolInteraction, euint32.unwrap(activityScore));
    }
}
