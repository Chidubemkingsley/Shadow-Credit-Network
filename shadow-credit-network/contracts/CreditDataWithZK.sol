// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface IEncryptedCreditEngineBridge {
    function submitCreditData(
        InEuint64 calldata income,
        InEuint64 calldata totalDebt,
        InEuint32 calldata paymentHistory,
        InEuint32 calldata creditUtilization,
        InEuint32 calldata accountAge,
        InEuint32 calldata numDefaults
    ) external;

    function register() external;
    function isRegistered(address user) external view returns (bool);
}

interface ICreditDataVerifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[1] calldata _pubSignals
    ) external view returns (bool);
}

/// @title CreditDataWithZK
/// @notice Integration contract that bridges ZK proof verification with encrypted
///      credit data submission. Requires valid ZK proofs before accepting encrypted
///      inputs into the EncryptedCreditEngine.
/// @dev Hybrid ZK+FHE flow:
///      1. User generates ZK proof off-chain (validates input ranges/authenticity)
///      2. User encrypts data via Cofhe SDK
///      3. User submits proof + encrypted data to this contract
///      4. This contract verifies the ZK proof on-chain
///      5. If valid, forwards encrypted data to EncryptedCreditEngine
///      6. FHE computation executes on verified data
contract CreditDataWithZK {

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event ZKProofVerified(address indexed user, bytes32 vkHash, bool valid);
    event CreditDataSubmittedWithProof(address indexed user, uint256 proofId);
    event VerifierSet(address indexed verifier);
    event CreditEngineSet(address indexed engine);
    event ProofNonceUsed(address indexed user, uint256 nonce);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error InvalidProof();
    error VerifierNotSet();
    error CreditEngineNotSet();
    error ProofAlreadyUsed();
    error NotRegistered();
    error InvalidPublicInputs();
    error ProofExpired();
    error UnauthorizedCaller();

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    /// @notice A submitted proof with its metadata
    struct ProofSubmission {
        address prover;
        bytes32 vkHash;
        uint256 submittedAt;
        bool verified;
        uint256 proofNonce;
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @notice ZK verifier contract
    ICreditDataVerifier public verifier;

    /// @notice Credit engine contract (integration target)
    address public creditEngine;

    /// @notice Credit engine interface for forwarding calls
    IEncryptedCreditEngineBridge public creditEngineInterface;

    /// @notice Nonce tracker per user (anti-replay)
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    /// @notice Submissions by proof ID
    mapping(uint256 => ProofSubmission) public submissions;

    /// @notice Submission counter
    uint256 public submissionCount;

    /// @notice Maximum proof age in seconds
    uint256 public maxProofAge;

    /// @notice Owner address
    address public owner;

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(address _owner) {
        require(_owner != address(0), "Invalid owner");
        owner = _owner;
        maxProofAge = 1 hours;
    }

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyRegistered() {
        if (!creditEngineInterface.isRegistered(msg.sender)) revert NotRegistered();
        _;
    }

    // ──────────────────────────────────────────────
    //  Core: Submit Credit Data with ZK Proof
    // ──────────────────────────────────────────────

    /// @notice Submit encrypted credit data with a ZK proof validating input authenticity
    /// @param pA Proof element A [2]
    /// @param pB Proof element B [2][2]
    /// @param pC Proof element C [2]
    /// @param pubSignals Public signals (commitment)
    /// @param proofNonce Unique nonce for replay protection
    /// @param income Encrypted annual income
    /// @param totalDebt Encrypted total debt
    /// @param paymentHistory Encrypted payment reliability (0-10000 bps)
    /// @param creditUtilization Encrypted utilization ratio (0-10000 bps)
    /// @param accountAge Encrypted account age in days
    /// @param numDefaults Encrypted number of defaults
    function submitWithProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[1] calldata pubSignals,
        uint256 proofNonce,
        InEuint64 calldata income,
        InEuint64 calldata totalDebt,
        InEuint32 calldata paymentHistory,
        InEuint32 calldata creditUtilization,
        InEuint32 calldata accountAge,
        InEuint32 calldata numDefaults
    ) external onlyRegistered {
        if (address(verifier) == address(0)) revert VerifierNotSet();
        if (address(creditEngineInterface) == address(0)) revert CreditEngineNotSet();

        if (usedNonces[msg.sender][proofNonce]) revert ProofAlreadyUsed();
        usedNonces[msg.sender][proofNonce] = true;

        bool proofValid = verifier.verifyProof(pA, pB, pC, pubSignals);
        if (!proofValid) revert InvalidProof();

        emit ZKProofVerified(msg.sender, bytes32(0), true);

        uint256 submissionId = submissionCount++;
        submissions[submissionId] = ProofSubmission({
            prover: msg.sender,
            vkHash: bytes32(0),
            submittedAt: block.timestamp,
            verified: true,
            proofNonce: proofNonce
        });

        creditEngineInterface.submitCreditData(
            income,
            totalDebt,
            paymentHistory,
            creditUtilization,
            accountAge,
            numDefaults
        );

        emit CreditDataSubmittedWithProof(msg.sender, submissionId);
    }

    /// @notice Verify a ZK proof without submitting data
    /// @param pA Proof element A [2]
    /// @param pB Proof element B [2][2]
    /// @param pC Proof element C [2]
    /// @param pubSignals Public signals
    /// @return valid Whether the proof is valid
    function verifyOnly(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[1] calldata pubSignals
    ) external view returns (bool valid) {
        if (address(verifier) == address(0)) revert VerifierNotSet();
        return verifier.verifyProof(pA, pB, pC, pubSignals);
    }

    // ──────────────────────────────────────────────
    //  Proof Metadata
    // ──────────────────────────────────────────────

    /// @notice Check if a nonce has been used for a user
    function isNonceUsed(address user, uint256 nonce) external view returns (bool) {
        return usedNonces[user][nonce];
    }

    /// @notice Get submission details
    function getSubmission(uint256 submissionId) external view returns (
        address prover,
        bytes32 vkHash,
        uint256 submittedAt,
        bool verified,
        uint256 proofNonce
    ) {
        ProofSubmission storage s = submissions[submissionId];
        return (s.prover, s.vkHash, s.submittedAt, s.verified, s.proofNonce);
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    /// @notice Set the ZK verifier contract
    function setVerifier(address _verifier) external onlyOwner {
        require(_verifier != address(0), "Invalid address");
        verifier = ICreditDataVerifier(_verifier);
        emit VerifierSet(_verifier);
    }

    /// @notice Set the credit engine contract
    function setCreditEngine(address _engine) external onlyOwner {
        require(_engine != address(0), "Invalid address");
        creditEngine = _engine;
        creditEngineInterface = IEncryptedCreditEngineBridge(_engine);
        emit CreditEngineSet(_engine);
    }

    /// @notice Update maximum proof age
    function setMaxProofAge(uint256 _maxAge) external onlyOwner {
        maxProofAge = _maxAge;
    }

    /// @notice Transfer ownership
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Invalid address");
        owner = _newOwner;
    }
}
