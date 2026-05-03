// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title IZKVerifier
/// @notice Interface for ZK proof verification contracts.
/// @dev Supports pluggable proof verification systems (Groth16, PLONK, etc.)
///      for validating user input authenticity before FHE processing.
interface IZKVerifier {

    /// @notice Verify a ZK proof against public inputs
    /// @param proof The serialized proof data (proof.a, proof.b, proof.c for Groth16)
    /// @param publicInputs The public inputs to the circuit (in order)
    /// @return valid Whether the proof is valid
    function verifyProof(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool valid);

    /// @notice Verify a proof with a specific verification key
    /// @param vkHash Hash identifier of the verification key to use
    /// @param proof The serialized proof data
    /// @param publicInputs The public inputs
    /// @return valid Whether the proof is valid
    function verifyProofWithVK(
        bytes32 vkHash,
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool valid);

    /// @notice Check if a verification key is registered
    /// @param vkHash Hash identifier of the verification key
    /// @return exists Whether the VK exists
    function hasVerificationKey(bytes32 vkHash) external view returns (bool exists);

    /// @notice Get the proof system type
    /// @return systemType Identifier string for the proof system (e.g., "groth16", "plonk")
    function proofSystemType() external view returns (string memory systemType);
}
