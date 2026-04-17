// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface ITaskManager {
    function resolveBool(bytes32 inputHash, uint256 resolverId) external returns (bool);
}

contract EncryptedCreditEngineV2 is Ownable {

    using FHE for *;

    // ──────────────────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────────────────

    event UserRegistered(address indexed user);
    event CreditDataSubmitted(address indexed user);
    event CreditScoreComputed(address indexed user, uint256 score);
    event CreditApproved(address indexed user, bool approved);

    // ──────────────────────────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error NoCreditData();
    error InsufficientCreditScore();
    error NotAuthorized();

    // ──────────────────────────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────────────────────────

    ITaskManager public taskManager;
    
    // Encrypted credit profiles
    mapping(address => euint64) public encIncome;
    mapping(address => euint64) public encTotalDebt;
    mapping(address => euint32) public encPaymentHistory;
    mapping(address => euint32) public encCreditUtilization;
    mapping(address => euint32) public encAccountAge;
    mapping(address => euint32) public encNumDefaults;
    
    // Computed scores (encrypted)
    mapping(address => euint32) public encCreditScore;
    mapping(address => bool) public hasCreditScore;
    mapping(address => bool) public isRegistered;
    
    // Thresholds (encrypted)
    euint32 public primeThreshold;
    euint32 public nearPrimeThreshold;
    euint32 public subprimeThreshold;
    
    address[] public registeredUsers;

    // ──────────────────────────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor(address _taskManager, address _owner) Ownable(_owner) {
        taskManager = ITaskManager(_taskManager);
        
        // Initialize encrypted thresholds
        primeThreshold = FHE.asEuint32(740);
        nearPrimeThreshold = FHE.asEuint32(670);
        subprimeThreshold = FHE.asEuint32(580);
        
        // Allow contract to access encrypted values
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
    //  Real FHE Credit Data Submission
    // ──────────────────────────────────────────────────────────────────

    /**
     * @notice Submit encrypted credit data using InEuint* ciphertexts
     * @dev Data arrives encrypted from CoFHE client, gets converted to euint types
     */
    function submitCreditData(
        InEuint64 calldata _income,
        InEuint64 calldata _totalDebt,
        InEuint32 calldata _paymentHistory,
        InEuint32 calldata _creditUtilization,
        InEuint32 calldata _accountAge,
        InEuint32 calldata _numDefaults
    ) external {
        if (!isRegistered[msg.sender]) revert NotRegistered();
        
        // Convert encrypted inputs to euint types
        // This runs FHE operations on the encrypted data
        encIncome[msg.sender] = FHE.asEuint64(_income);
        encTotalDebt[msg.sender] = FHE.asEuint64(_totalDebt);
        encPaymentHistory[msg.sender] = FHE.asEuint32(_paymentHistory);
        encCreditUtilization[msg.sender] = FHE.asEuint32(_creditUtilization);
        encAccountAge[msg.sender] = FHE.asEuint32(_accountAge);
        encNumDefaults[msg.sender] = FHE.asEuint32(_numDefaults);
        
        // Grant access for computations
        FHE.allowThis(encIncome[msg.sender]);
        FHE.allowThis(encTotalDebt[msg.sender]);
        FHE.allowThis(encPaymentHistory[msg.sender]);
        FHE.allowThis(encCreditUtilization[msg.sender]);
        FHE.allowThis(encAccountAge[msg.sender]);
        FHE.allowThis(encNumDefaults[msg.sender]);
        
        emit CreditDataSubmitted(msg.sender);
    }

    // ──────────────────────────────────────────────────────────────────
    //  FHE Credit Score Computation
    // ──────────────────────────────────────────────────────────────────

    /**
     * @notice Compute credit score entirely in encrypted domain
     * @dev All operations run on ciphertexts - no plaintext exposed
     */
    function computeCreditScore() external {
        if (!isRegistered[msg.sender]) revert NotRegistered();
        
        euint32 paymentHistory = encPaymentHistory[msg.sender];
        euint32 utilization = encCreditUtilization[msg.sender];
        euint32 accountAge = encAccountAge[msg.sender];
        euint32 defaults = encNumDefaults[msg.sender];
        
        // Payment Score: (paymentHistory / 10000) * 255
        euint32 maxBP = FHE.asEuint32(10000);
        euint32 paymentScore = FHE.div(FHE.mul(paymentHistory, FHE.asEuint32(255)), maxBP);
        
        // Utilization Score: ((10000 - utilization) / 10000) * 120
        euint32 utilInv = FHE.sub(maxBP, utilization);
        euint32 utilScore = FHE.div(FHE.mul(utilInv, FHE.asEuint32(120)), maxBP);
        
        // Age Score: min(accountAge / 365, 10) * 15
        euint32 daysPerYear = FHE.asEuint32(365);
        euint32 maxAgeScore = FHE.asEuint32(10);
        euint32 years = FHE.div(accountAge, daysPerYear);
        euint32 cappedYears = FHE.select(FHE.gt(years, maxAgeScore), maxAgeScore, years);
        euint32 ageScore = FHE.mul(cappedYears, FHE.asEuint32(15));
        
        // Default Penalty: defaults * 50
        euint32 penalty = FHE.mul(defaults, FHE.asEuint32(50));
        
        // Base + components - penalty
        euint32 base = FHE.asEuint32(300);
        euint32 total = FHE.add(base, paymentScore);
        total = FHE.add(total, utilScore);
        total = FHE.add(total, ageScore);
        total = FHE.sub(total, penalty);
        
        // Clamp to [300, 850]
        euint32 minScore = FHE.asEuint32(300);
        euint32 maxScore = FHE.asEuint32(850);
        encCreditScore[msg.sender] = FHE.select(
            FHE.lt(total, minScore), 
            minScore, 
            FHE.select(FHE.gt(total, maxScore), maxScore, total)
        );
        
        hasCreditScore[msg.sender] = true;
        
        FHE.allowThis(encCreditScore[msg.sender]);
        
        emit CreditScoreComputed(msg.sender, 0); // Score is encrypted
    }

    // ──────────────────────────────────────────────────────────────────
    //  FHE-Based Credit Approval (eBool Resolution)
    // ──────────────────────────────────────────────────────────────────

    /**
     * @notice Check if user meets credit threshold for a loan
     * @dev Returns encrypted ebool - resolves via TaskManager
     */
    function checkCreditApproval(address user, uint256 minScore) external view returns (bool) {
        if (!hasCreditScore[user]) revert NoCreditData();
        
        euint32 threshold = FHE.asEuint32(minScore);
        ebool meetsThreshold = FHE.gte(encCreditScore[user], threshold);
        
        return meetsThreshold;
    }

    /**
     * @notice Get decrypted credit score (requires decryption request)
     */
    function getCreditScore(address user) external view returns (uint256) {
        if (!hasCreditScore[user]) revert NoCreditData();
        
        return FHE.decrypt(encCreditScore[user]);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────────────────────────

    function setTaskManager(address _taskManager) external onlyOwner {
        taskManager = ITaskManager(_taskManager);
    }
}