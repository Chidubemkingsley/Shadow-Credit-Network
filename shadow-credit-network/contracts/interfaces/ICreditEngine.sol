// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface ICreditEngine {
    function getCreditScore(address _user) external view returns (euint32);
    function hasComputedScore(address _user) external view returns (bool);
    function getRiskTier(address _user) external view returns (euint8);
    function isRegistered(address _user) external view returns (bool);
    function getBorrowingPower(address _user) external view returns (euint64);
    function grantAccess(address _user) external;
    function checkScoreMeetsThreshold(address _user, euint32 _minScore) external returns (euint8);
    function checkCreditThreshold(address _user, uint256 _minScore) external returns (bool);
}
