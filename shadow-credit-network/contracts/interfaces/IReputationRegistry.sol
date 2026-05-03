// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title IReputationRegistry
/// @notice Interface for the ReputationRegistry — used by lending and delegation
///         contracts to update reputation on-chain after protocol events.
interface IReputationRegistry {
    enum ReputationFactor {
        TransactionReliability,  // 0
        StakingHistory,          // 1
        GovernanceParticipation, // 2
        ProtocolInteraction,     // 3
        SocialVerification,      // 4
        DefaultHistory           // 5 — inverse: high score = many defaults = bad
    }

    function isRegistered(address _user) external view returns (bool);

    /// @notice Update a single reputation factor (integration contracts only)
    function updateReputation(
        address _user,
        ReputationFactor _factor,
        InEuint32 calldata _newScore
    ) external;

    function getActiveAttestationCount(address _user) external view returns (uint256);
    function getRegisteredAt(address _user) external view returns (uint256);
    function getLastActivityAt(address _user) external view returns (uint256);
}
