// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./interfaces/IZKVerifier.sol";

/// @title Groth16Verifier
/// @notice On-chain Groth16 ZK proof verifier using BN256 pairing precompiles.
/// @dev Stores verification keys on-chain and validates proofs submitted alongside
///      encrypted credit data. Ensures input authenticity before FHE computation.
///
///      Proof flow:
///      1. User generates ZK proof off-chain (snarkjs + circom circuit)
///      2. User encrypts data via Cofhe SDK
///      3. User submits proof + encrypted data to CreditEngine
///      4. CreditEngine calls this verifier to validate proof
///      5. If valid, encrypted data is accepted for FHE computation
contract Groth16Verifier is IZKVerifier {

    // ──────────────────────────────────────────────
    //  Pairing Precompile Addresses
    // ──────────────────────────────────────────────

    address constant G1_ADD = 0x0000000000000000000000000000000000000006;
    address constant G1_MUL = 0x0000000000000000000000000000000000000007;
    address constant PAIRING = 0x0000000000000000000000000000000000000008;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event VerificationKeyRegistered(bytes32 indexed vkHash, uint256 publicInputCount);
    event VerificationKeyRemoved(bytes32 indexed vkHash);
    event ProofVerified(bytes32 indexed vkHash, address indexed prover, bool valid);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error VerificationKeyNotFound();
    error InvalidProofLength();
    error InvalidPublicInputCount();
    error ProofVerificationFailed();
    error ZeroAddress();

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    /// @notice Groth16 verification key (BN256 curve)
    struct VerificationKey {
        uint256[2] alpha;       // G1 point
        uint256[2] beta;        // G2 point
        uint256[2] gamma;       // G2 point
        uint256[2] delta;       // G2 point
        uint256[] icX;          // G1 IC points x-coordinates
        uint256[] icY;          // G1 IC points y-coordinates
        uint256 publicInputCount;
        bool exists;
    }

    /// @notice Groth16 proof structure
    struct Proof {
        uint256[2] a;           // G1 point
        uint256[2][2] b;        // G2 point
        uint256[2] c;           // G1 point
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @notice Stored verification keys by hash
    mapping(bytes32 => VerificationKey) private verificationKeys;

    /// @notice List of registered VK hashes
    bytes32[] private registeredVKs;

    /// @notice Authorized verifiers who can submit proofs with VK hash
    mapping(address => bool) public authorizedVerifiers;

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor() {}

    // ──────────────────────────────────────────────
    //  Verification Key Management
    // ──────────────────────────────────────────────

    /// @notice Register a verification key for proof verification
    /// @param vkHash Unique hash identifier for the VK
    /// @param alpha G1 alpha point [x, y]
    /// @param beta G2 beta point [[x1, x2], [y1, y2]]
    /// @param gamma G2 gamma point [[x1, x2], [y1, y2]]
    /// @param delta G2 delta point [[x1, x2], [y1, y2]]
    /// @param icX G1 IC x-coordinates
    /// @param icY G1 IC y-coordinates
    function registerVerificationKey(
        bytes32 vkHash,
        uint256[2] calldata alpha,
        uint256[2][2] calldata beta,
        uint256[2][2] calldata gamma,
        uint256[2][2] calldata delta,
        uint256[] calldata icX,
        uint256[] calldata icY
    ) external {
        require(icX.length == icY.length, "IC length mismatch");

        verificationKeys[vkHash] = VerificationKey({
            alpha: alpha,
            beta: [beta[0][0], beta[0][1]],
            gamma: [gamma[0][0], gamma[0][1]],
            delta: [delta[0][0], delta[0][1]],
            icX: icX,
            icY: icY,
            publicInputCount: icX.length - 1,
            exists: true
        });

        registeredVKs.push(vkHash);

        emit VerificationKeyRegistered(vkHash, icX.length - 1);
    }

    /// @notice Remove a verification key
    function removeVerificationKey(bytes32 vkHash) external {
        if (!verificationKeys[vkHash].exists) revert VerificationKeyNotFound();
        verificationKeys[vkHash].exists = false;
        emit VerificationKeyRemoved(vkHash);
    }

    // ──────────────────────────────────────────────
    //  Proof Verification
    // ──────────────────────────────────────────────

    /// @inheritdoc IZKVerifier
    function verifyProofWithVK(
        bytes32 vkHash,
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view override returns (bool valid) {
        VerificationKey storage vk = verificationKeys[vkHash];
        if (!vk.exists) revert VerificationKeyNotFound();

        if (publicInputs.length != vk.publicInputCount) {
            revert InvalidPublicInputCount();
        }

        return _verifyGroth16(vk, proof, publicInputs);
    }

    /// @inheritdoc IZKVerifier
    function verifyProof(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view override returns (bool valid) {
        if (registeredVKs.length == 0) revert VerificationKeyNotFound();
        return this.verifyProofWithVK(registeredVKs[0], proof, publicInputs);
    }

    /// @notice Internal Groth16 verification using BN256 pairing
    function _verifyGroth16(
        VerificationKey storage vk,
        bytes calldata proofData,
        uint256[] calldata publicInputs
    ) internal view returns (bool) {
        Proof memory proof = _decodeProof(proofData);

        // Compute vk_x = IC[0] + sum(publicInputs[i] * IC[i+1])
        uint256[2] memory vkX = [vk.icX[0], vk.icY[0]];
        for (uint256 i = 0; i < publicInputs.length; i++) {
            uint256[2] memory multiplied = _g1Mul(
                [vk.icX[i + 1], vk.icY[i + 1]],
                publicInputs[i]
            );
            vkX = _g1Add(vkX, multiplied);
        }

        // Build the 4-pair pairing check:
        // e(-A, B) * e(alpha, beta) * e(vkX, gamma) * e(C, delta) == 1
        return _pairingCheck(proof, vk, vkX);
    }

    function _pairingCheck(
        Proof memory proof,
        VerificationKey storage vk,
        uint256[2] memory vkX
    ) internal view returns (bool) {
        uint256[2] memory negA = _g1Neg(proof.a);

        // Build pairing input in stages to avoid stack-too-deep
        bytes memory part1 = abi.encodePacked(
            negA[0], negA[1],
            proof.b[0][0], proof.b[0][1],
            proof.b[1][0], proof.b[1][1]
        );
        bytes memory part2 = abi.encodePacked(
            vk.alpha[0], vk.alpha[1],
            vk.beta[0], vk.beta[1]
        );
        bytes memory part3 = abi.encodePacked(
            vkX[0], vkX[1],
            vk.gamma[0], vk.gamma[1]
        );
        bytes memory part4 = abi.encodePacked(
            proof.c[0], proof.c[1],
            vk.delta[0], vk.delta[1]
        );

        bytes memory input = _concatBytes(_concatBytes(part1, part2), _concatBytes(part3, part4));

        (bool success, bytes memory result) = PAIRING.staticcall(input);
        if (!success) return false;
        return abi.decode(result, (bool));
    }

    function _concatBytes(bytes memory a, bytes memory b) internal pure returns (bytes memory) {
        bytes memory result = new bytes(a.length + b.length);
        for (uint256 i = 0; i < a.length; i++) result[i] = a[i];
        for (uint256 i = 0; i < b.length; i++) result[a.length + i] = b[i];
        return result;
    }

    // ──────────────────────────────────────────────
    //  Elliptic Curve Operations
    // ──────────────────────────────────────────────

    function _g1Add(uint256[2] memory a, uint256[2] memory b) internal view returns (uint256[2] memory) {
        bytes memory input = abi.encode(a[0], a[1], b[0], b[1]);
        (bool success, bytes memory result) = G1_ADD.staticcall(input);
        require(success, "G1_ADD failed");
        return abi.decode(result, (uint256[2]));
    }

    function _g1Mul(uint256[2] memory point, uint256 scalar) internal view returns (uint256[2] memory) {
        bytes memory input = abi.encode(point[0], point[1], scalar);
        (bool success, bytes memory result) = G1_MUL.staticcall(input);
        require(success, "G1_MUL failed");
        return abi.decode(result, (uint256[2]));
    }

    function _g1Neg(uint256[2] memory point) internal pure returns (uint256[2] memory) {
        // For BN256, negation of (x, y) is (x, p - y) where p is the field prime
        uint256 p = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
        if (point[1] == 0) return point;
        return [point[0], p - (point[1] % p)];
    }

    // ──────────────────────────────────────────────
    //  Proof Decoding
    // ──────────────────────────────────────────────

    function _decodeProof(bytes calldata data) internal pure returns (Proof memory proof) {
        // Groth16 proof: a[2], b[2][2], c[2] = 6 uint256 values
        if (data.length < 192) revert InvalidProofLength();

        assembly {
            calldatacopy(proof, data.offset, 192)
        }
    }

    // ──────────────────────────────────────────────
    //  IZKVerifier Interface
    // ──────────────────────────────────────────────

    /// @inheritdoc IZKVerifier
    function hasVerificationKey(bytes32 vkHash) external view override returns (bool exists) {
        return verificationKeys[vkHash].exists;
    }

    /// @inheritdoc IZKVerifier
    function proofSystemType() external pure override returns (string memory) {
        return "groth16";
    }

    // ──────────────────────────────────────────────
    //  Read-Only Queries
    // ──────────────────────────────────────────────

    /// @notice Get the number of registered verification keys
    function getVerificationKeyCount() external view returns (uint256) {
        return registeredVKs.length;
    }

    /// @notice Get a verification key hash by index
    function getVerificationKeyHash(uint256 index) external view returns (bytes32) {
        return registeredVKs[index];
    }

    /// @notice Get the public input count for a VK
    function getPublicInputCount(bytes32 vkHash) external view returns (uint256) {
        if (!verificationKeys[vkHash].exists) revert VerificationKeyNotFound();
        return verificationKeys[vkHash].publicInputCount;
    }
}
