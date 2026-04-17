// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";

contract SimpleCreditEngine is Ownable {

    event UserRegistered(address indexed user);
    event CreditDataSubmitted(address indexed user);
    event CreditScoreComputed(address indexed user, uint32 score);

    error AlreadyRegistered();
    error NotRegistered();
    error NoScoreComputed();

    struct CreditProfile {
        uint256 income;
        uint256 totalDebt;
        uint256 paymentHistory;
        uint256 creditUtilization;
        uint256 accountAge;
        uint256 numDefaults;
        bool isActive;
    }

    struct CreditScoreData {
        uint32 score;
        uint8 riskTier;
        bool computed;
    }

    mapping(address => CreditProfile) public profiles;
    mapping(address => CreditScoreData) public scores;
    address[] public registeredUsers;

    constructor(address _owner) Ownable(_owner) {}

    function register() external {
        if (profiles[msg.sender].isActive) revert AlreadyRegistered();

        profiles[msg.sender] = CreditProfile({
            income: 0,
            totalDebt: 0,
            paymentHistory: 10000,
            creditUtilization: 0,
            accountAge: 0,
            numDefaults: 0,
            isActive: true
        });

        registeredUsers.push(msg.sender);
        emit UserRegistered(msg.sender);
    }

    function submitCreditData(
        uint256 _income,
        uint256 _totalDebt,
        uint256 _paymentHistory,
        uint256 _creditUtilization,
        uint256 _accountAge,
        uint256 _numDefaults
    ) external {
        if (!profiles[msg.sender].isActive) revert NotRegistered();

        profiles[msg.sender].income = _income;
        profiles[msg.sender].totalDebt = _totalDebt;
        profiles[msg.sender].paymentHistory = _paymentHistory;
        profiles[msg.sender].creditUtilization = _creditUtilization;
        profiles[msg.sender].accountAge = _accountAge;
        profiles[msg.sender].numDefaults = _numDefaults;

        emit CreditDataSubmitted(msg.sender);
    }

    function computeCreditScore() external {
        if (!profiles[msg.sender].isActive) revert NotRegistered();

        CreditProfile storage p = profiles[msg.sender];

        uint256 paymentScore = (p.paymentHistory * 255) / 10000;
        uint256 utilizationScore = ((10000 - p.creditUtilization) * 120) / 10000;
        uint256 accountYears = p.accountAge / 365;
        if (accountYears > 10) accountYears = 10;
        uint256 ageScore = accountYears * 15;
        uint256 penalty = p.numDefaults * 50;

        uint256 rawScore = 300 + paymentScore + utilizationScore + ageScore;
        if (rawScore > penalty) {
            rawScore -= penalty;
        } else {
            rawScore = 300;
        }

        if (rawScore > 850) rawScore = 850;
        if (rawScore < 300) rawScore = 300;

        uint8 tier;
        if (rawScore >= 740) tier = 0;
        else if (rawScore >= 670) tier = 1;
        else if (rawScore >= 580) tier = 2;
        else tier = 3;

        scores[msg.sender] = CreditScoreData({
            score: uint32(rawScore),
            riskTier: tier,
            computed: true
        });

        emit CreditScoreComputed(msg.sender, uint32(rawScore));
    }

    function isRegistered(address _user) external view returns (bool) {
        return profiles[_user].isActive;
    }

    function hasComputedScore(address _user) external view returns (bool) {
        return scores[_user].computed;
    }

    function getDecryptedScoreSafe() external view returns (uint32 score, bool isDecrypted) {
        CreditScoreData storage s = scores[msg.sender];
        return (s.score, s.computed);
    }

    function getRiskTier(address _user) external view returns (uint8) {
        return scores[_user].riskTier;
    }

    function checkCreditThreshold(address _user, uint256 _minScore) external view returns (bool) {
        if (!scores[_user].computed) return false;
        return scores[_user].score >= _minScore;
    }
}
