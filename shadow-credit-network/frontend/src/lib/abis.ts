// ─────────────────────────────────────────────────────────────────────────────
//  Contract ABIs — extracted from Wave 3 Solidity contracts
//  InEuint* structs: (uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature)
// ─────────────────────────────────────────────────────────────────────────────

const IN_EUINT64 = "tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature)";
const IN_EUINT32 = "tuple(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature)";

// ── EncryptedCreditEngineV3 ───────────────────────────────────────────────────
export const CREDIT_ENGINE_V3_ABI = [
  // Registration
  "function register() external",
  "function isRegistered(address) external view returns (bool)",
  // Credit data — real InEuint* ciphertexts from CoFHE SDK
  `function submitCreditData(${IN_EUINT64} _income, ${IN_EUINT64} _totalDebt, ${IN_EUINT32} _paymentHistory, ${IN_EUINT32} _creditUtilization, ${IN_EUINT32} _accountAge, ${IN_EUINT32} _numDefaults) external`,
  // Score computation
  "function computeCreditScore() external",
  "function hasCreditScore(address) external view returns (bool)",
  "function scoreComputedAt(address) external view returns (uint256)",
  "function isScoreStale(address) external view returns (bool)",
  "function scoreValidityPeriod() external view returns (uint256)",
  // Score decryption (FHE.decrypt async pattern)
  "function requestScoreDecryption() external",
  "function getDecryptedScore(address user) external view returns (uint32 score, bool isDecrypted)",
  // Borrowing power (Wave 3)
  "function computeBorrowingPower() external",
  "function hasBorrowingPower(address) external view returns (bool)",
  "function getBorrowingPowerCtHash(address user) external view returns (uint256)",
  // Score history (Wave 3)
  "function getScoreHistoryLength(address user) external view returns (uint256)",
  "function getScoreHistoryAt(address user, uint256 index) external view returns (uint256)",
  // Cross-contract score sharing (Wave 3)
  "function grantScoreAccess(address recipient) external",
  "function authorizedContracts(address) external view returns (bool)",
  // Approval checks (ebool-gated loan disbursement)
  "function requestApprovalCheck(address user, uint256 minScore) external returns (bytes32 checkId, uint256 eboolCtHash)",
  "function resolveApprovalCheck(bytes32 checkId) external returns (bool ready, bool approved)",
  "function getApprovalCheckStatus(bytes32 checkId) external view returns (bool exists, bool resolved, bool approved, address user, uint256 minScore, uint256 eboolCtHash)",
  // Read-only
  "function getUserCount() external view returns (uint256)",
  "function reputationRegistry() external view returns (address)",
  // Events
  "event UserRegistered(address indexed user)",
  "event CreditDataSubmitted(address indexed user)",
  "event CreditScoreComputed(address indexed user, uint256 scoreCtHash)",
  "event ScoreDecryptionRequested(address indexed user, uint256 ctHash)",
  "event BorrowingPowerComputed(address indexed user, uint256 powerCtHash)",
  "event ApprovalCheckCreated(bytes32 indexed checkId, address indexed user, uint256 minScore, uint256 eboolCtHash)",
  "event ApprovalCheckResolved(bytes32 indexed checkId, address indexed user, bool approved)",
  "event ScoreAccessGranted(address indexed user, address indexed recipient)",
] as const;

// ── SimpleCreditEngine (Wave 1 — live on Base Sepolia, plaintext) ─────────────
export const SIMPLE_CREDIT_ENGINE_ABI = [
  "function register() external",
  "function isRegistered(address) external view returns (bool)",
  "function submitCreditData(uint256 income, uint256 totalDebt, uint256 paymentHistory, uint256 creditUtilization, uint256 accountAge, uint256 numDefaults) external",
  "function computeCreditScore() external",
  "function hasComputedScore(address) external view returns (bool)",
  "function getDecryptedScoreSafe() external view returns (uint32 score, bool isDecrypted)",
  "function getRiskTier(address) external view returns (uint8)",
  "function checkCreditThreshold(address user, uint256 minScore) external view returns (bool)",
  "event UserRegistered(address indexed user)",
  "event CreditDataSubmitted(address indexed user)",
  "event CreditScoreComputed(address indexed user, uint32 score)",
] as const;

// ── PrivateLoanPoolV3 ─────────────────────────────────────────────────────────
export const LOAN_POOL_V3_ABI = [
  // Lender
  "function fundPool() external payable",
  "function withdrawFunds(uint256 amount) external",
  "function claimYield() external",                                    // Wave 3: yield distribution
  "function lenderYieldEarned(address) external view returns (uint256)", // Wave 3
  "function getLenderDeposit(address) external view returns (uint256 amount, uint256 depositedAt)",
  "function getLenderCount() external view returns (uint256)",
  "function getLenderAtIndex(uint256) external view returns (address)",
  // Pool state
  "function totalPoolLiquidity() external view returns (uint256)",
  "function totalLoanedOut() external view returns (uint256)",
  "function totalInterestCollected() external view returns (uint256)",  // Wave 3
  "function getAvailableLiquidity() external view returns (uint256)",
  "function loanCount() external view returns (uint256)",
  // Borrower
  "function requestLoan(uint256 principal, uint256 duration, uint8 riskPool) external",
  "function resolveLoanApproval(uint256 loanId) external",
  "function repayLoan(uint256 loanId) external payable",
  "function refinanceLoan(uint256 loanId, uint8 newPool) external",    // Wave 3
  // Loan queries
  "function getLoan(uint256) external view returns (address borrower, uint256 principal, uint256 totalOwed, uint256 repaidAmount, uint256 interestRate, uint256 dueDate, uint256 status)",
  "function getLoanApprovalStatus(uint256) external view returns (bool approvalResolved, bool approvalPassed, bytes32 checkId, uint256 eboolCtHash)",
  "function getBorrowerLoans(address) external view returns (uint256[])",
  // State
  "function paused() external view returns (bool)",
  "function minLoanAmount() external view returns (uint256)",
  "function maxLoanAmount() external view returns (uint256)",
  // Events
  "event PoolFunded(address indexed lender, uint256 amount)",
  "event PoolWithdrawn(address indexed lender, uint256 amount)",
  "event YieldClaimed(address indexed lender, uint256 amount)",
  "event LoanRequested(address indexed borrower, uint256 indexed loanId, uint256 principal)",
  "event LoanApprovalCheckRequested(address indexed borrower, uint256 indexed loanId, bytes32 indexed checkId, uint256 eboolCtHash)",
  "event LoanApprovalResolved(address indexed borrower, uint256 indexed loanId, bool approved)",
  "event LoanApproved(address indexed borrower, uint256 indexed loanId)",
  "event LoanDisbursed(address indexed borrower, uint256 indexed loanId, uint256 amount)",
  "event RepaymentMade(address indexed borrower, uint256 indexed loanId, uint256 amount, bool fullRepayment)",
  "event LoanDefaulted(address indexed borrower, uint256 indexed loanId)",
  "event LoanRefinanced(address indexed borrower, uint256 oldLoanId, uint256 newLoanId)",
] as const;

// ── PrivateLoanPool (Wave 1 — live on Base Sepolia, plaintext) ────────────────
export const LOAN_POOL_ABI = [
  "function fundPool() external payable",
  "function withdrawFunds(uint256 amount) external",
  "function requestLoan(uint256 principal, uint256 duration, uint8 riskPool) external",
  "function repayLoan(uint256 loanId) external payable",
  "function getLoan(uint256) external view returns (address, uint256, uint256, uint256, uint256, uint256, uint256, bool, bool)",
  "function getLoanStatus(uint256) external view returns (uint256)",
  "function getBorrowerLoans(address) external view returns (uint256[])",
  "function getLenderDeposit(address) external view returns (uint256 amount, uint256 depositedAt)",
  "function getLenderCount() external view returns (uint256)",
  "function getLenderAtIndex(uint256) external view returns (address)",
  "function totalPoolLiquidity() external view returns (uint256)",
  "function getAvailableLiquidity() external view returns (uint256)",
  "function loanCount() external view returns (uint256)",
  "event PoolFunded(address indexed lender, uint256 amount)",
  "event LoanRequested(address indexed borrower, uint256 loanId)",
  "event LoanApproved(address indexed borrower, uint256 loanId)",
  "event RepaymentMade(address indexed borrower, uint256 loanId, uint256 amount)",
] as const;

// ── CreditDelegationV2 ────────────────────────────────────────────────────────
export const DELEGATION_V2_ABI = [
  // Offers
  "function createOffer(uint256 maxAmount, uint256 yieldRate, uint256 minScore, uint256 maxBonds) external",
  "function cancelOffer(uint256 offerId) external",
  "function acceptOffer(uint256 offerId, uint256 amount, uint256 duration) external",
  "function offerCount() external view returns (uint256)",
  "function getOffer(uint256) external view returns (address delegator, uint256 maxAmount, uint256 yieldRate, uint256 minScore, uint256 available, uint256 activeBonds, uint256 maxBonds, uint256 status)",
  "function getDelegatorOffers(address) external view returns (uint256[])",
  // Bonds
  "function repayBond(uint256 bondId) external payable",
  "function markExpiredDefault(uint256 bondId) external",             // Wave 3: permissionless expiry
  "function bondCount() external view returns (uint256)",
  "function getBond(uint256) external view returns (address delegator, address borrower, uint256 amount, uint256 repaid, uint256 yieldEarned, uint256 yieldPaidOut, uint256 yieldRate, uint256 dueDate, uint256 status)",
  "function getBondStatus(uint256) external view returns (uint256)",
  "function getBorrowerBonds(address) external view returns (uint256[])",
  "function isBondExpired(uint256) external view returns (bool)",     // Wave 3
  // State
  "function defaultBondDuration() external view returns (uint256)",
  // Events
  "event DelegationOfferCreated(address indexed delegator, uint256 offerId)",
  "event DelegationOfferCancelled(address indexed delegator, uint256 offerId)",
  "event DelegationAccepted(address indexed delegator, address indexed borrower, uint256 offerId, uint256 bondId)",
  "event DelegationRepaid(address indexed borrower, uint256 bondId, uint256 amount, bool fullRepayment)",
  "event DelegationDefaulted(address indexed delegator, address indexed borrower, uint256 bondId)",
  "event YieldPaidOut(address indexed delegator, uint256 bondId, uint256 amount)",
] as const;

// ── CreditDelegation (Wave 1 — live on Base Sepolia) ─────────────────────────
export const DELEGATION_ABI = [
  "function createOffer(uint256 maxAmount, uint256 yieldRate, uint256 minScore, uint256 maxBonds) external",
  "function cancelOffer(uint256 offerId) external",
  "function acceptOffer(uint256 offerId, uint256 amount, uint256 duration) external",
  "function repayBond(uint256 bondId) external payable",
  "function offerCount() external view returns (uint256)",
  "function bondCount() external view returns (uint256)",
  "function getOffer(uint256) external view returns (address, uint256, uint256, uint256, uint256, uint256, uint256, uint256)",
  "function getOfferStatus(uint256) external view returns (uint256)",
  "function getBond(uint256) external view returns (address, address, uint256, uint256, uint256, uint256, uint256)",
  "function getBondStatus(uint256) external view returns (uint256)",
  "function getBorrowerBonds(address) external view returns (uint256[])",
  "function getDelegatorOffers(address) external view returns (uint256[])",
] as const;

// ── ReputationRegistry ────────────────────────────────────────────────────────
export const REPUTATION_REGISTRY_ABI = [
  "function register() external",
  "function isRegistered(address) external view returns (bool)",
  // Decryption
  "function requestDecryption() external",
  "function getDecryptedScoreSafe() external view returns (uint32 score, bool isDecrypted)",
  // Decay
  "function applyDecay(address user) external",
  "function decayInterval() external view returns (uint256)",
  // Metadata
  "function getRegisteredAt(address) external view returns (uint256)",
  "function getLastActivityAt(address) external view returns (uint256)",
  "function getActiveAttestationCount(address) external view returns (uint256)",
  "function getUserCount() external view returns (uint256)",
  "function minAttestations() external view returns (uint256)",
  // Events
  "event UserRegistered(address indexed user)",
  "event ReputationUpdated(address indexed user, uint8 factor, uint256 scoreHash)",
  "event DecayApplied(address indexed user, uint256 decayedFactors)",
  "event ActivityNotified(address indexed user, address indexed caller)",
] as const;
