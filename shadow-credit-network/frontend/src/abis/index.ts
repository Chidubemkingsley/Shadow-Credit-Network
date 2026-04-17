const IN_EUINT_64 = "tuple(uint256,uint8,uint8,bytes)";
const IN_EUINT_32 = "tuple(uint256,uint8,uint8,bytes)";

export const CREDIT_ENGINE_ABI = [
  "function register() external",
  "function isRegistered(address) external view returns (bool)",
  "function submitCreditData(uint256 income, uint256 totalDebt, uint256 paymentHistory, uint256 creditUtilization, uint256 accountAge, uint256 numDefaults) external",
  "function computeCreditScore() external",
  "function hasComputedScore(address) external view returns (bool)",
  "function getDecryptedScoreSafe() external view returns (uint32 score, bool isDecrypted)",
  "function getRiskTier(address) external view returns (uint8)",
  "function checkCreditThreshold(address _user, uint256 _minScore) external view returns (bool)",
  "event UserRegistered(address indexed user)",
  "event CreditDataSubmitted(address indexed user)",
  "event CreditScoreComputed(address indexed user, uint32 score)",
] as const

// PrivateLoanPool ABI (plaintext - no FHE types)
export const LOAN_POOL_ABI = [
  "function fundPool() external payable",
  "function withdrawFunds(uint256 amount) external",
  "function totalPoolLiquidity() external view returns (uint256)",
  "function getAvailableLiquidity() external view returns (uint256)",
  "function requestLoan(uint256 principal, uint256 duration, uint8 riskPool) external",
  "function repayLoan(uint256 loanId) external payable",
  "function getLoan(uint256) external view returns (address, uint256, uint256, uint256, uint256, uint256, uint256, bool, bool)",
  "function getLoanStatus(uint256) external view returns (uint256)",
  "function getBorrowerLoans(address) external view returns (uint256[])",
  "function loanCount() external view returns (uint256)",
  "function getLenderDeposit(address) external view returns (uint256 amount, uint256 depositedAt)",
  "function getLenderCount() external view returns (uint256)",
  "function getLenderAtIndex(uint256) external view returns (address)",
  "function markDefaulted(uint256 loanId) external",
  "function setCreditEngine(address engine) external",
  "function setPaused(bool paused) external",
  "function paused() external view returns (bool)",
  "event PoolFunded(address indexed lender, uint256 amount)",
  "event PoolWithdrawn(address indexed lender, uint256 amount)",
  "event LoanRequested(address indexed borrower, uint256 loanId)",
  "event LoanApproved(address indexed borrower, uint256 loanId)",
  "event CreditVerified(address indexed borrower, uint256 loanId, bool passed)",
  "event RepaymentMade(address indexed borrower, uint256 loanId, uint256 amount)",
  "event LoanDefaulted(address indexed borrower, uint256 loanId)",
] as const

// CreditDelegation ABI (simplified)
export const DELEGATION_ABI = [
  "function createOffer(uint256 maxAmount, uint256 yieldRate, uint256 minScore, uint256 maxBonds) external",
  "function cancelOffer(uint256 offerId) external",
  "function acceptOffer(uint256 offerId, uint256 amount, uint256 duration) external",
  "function repayBond(uint256 bondId) external payable",
  "function markDefaulted(uint256 bondId) external",
  "function getOffer(uint256) external view returns (address, uint256, uint256, uint256, uint256, uint256, uint256, uint256)",
  "function getOfferStatus(uint256) external view returns (uint256)",
  "function getBond(uint256) external view returns (address, address, uint256, uint256, uint256, uint256, uint256)",
  "function getBondStatus(uint256) external view returns (uint256)",
  "function offerCount() external view returns (uint256)",
  "function bondCount() external view returns (uint256)",
  "function getBorrowerBonds(address) external view returns (uint256[])",
  "function getDelegatorOffers(address) external view returns (uint256[])",
  "event DelegationOfferCreated(address indexed delegator, uint256 offerId)",
  "event DelegationOfferCancelled(address indexed delegator, uint256 offerId)",
  "event DelegationAccepted(address indexed delegator, address indexed borrower, uint256 offerId, uint256 bondId)",
  "event DelegationRepaid(address indexed borrower, uint256 bondId)",
  "event DelegationDefaulted(address indexed delegator, address indexed borrower, uint256 bondId)",
] as const

// ReputationRegistry ABI (minimal)
export const REPUTATION_ABI = [
  "function register() external",
  "function isRegistered(address) external view returns (bool)",
  "function getCompositeScore(address) external view returns (tuple(uint256))",
  "function requestDecryption() external",
  "function getDecryptedScoreSafe() external view returns (uint32, bool)",
  "function getActiveAttestationCount(address) external view returns (uint256)",
] as const

// CreditDataWithZK ABI (updated to match deployed contract)
export const CREDIT_DATA_ZK_ABI = [
  `function submitWithProof(
    uint256[2] calldata pA,
    uint256[2][2] calldata pB,
    uint256[2] calldata pC,
    uint256[1] calldata pubSignals,
    uint256 proofNonce,
    ${IN_EUINT_64} memory income,
    ${IN_EUINT_64} memory totalDebt,
    ${IN_EUINT_32} memory paymentHistory,
    ${IN_EUINT_32} memory creditUtilization,
    ${IN_EUINT_32} memory accountAge,
    ${IN_EUINT_32} memory numDefaults
  ) external`,
  "function verifyOnly(uint256[2] calldata pA, uint256[2][2] calldata pB, uint256[2] calldata pC, uint256[1] calldata pubSignals) external view returns (bool)",
  "function isNonceUsed(address user, uint256 nonce) external view returns (bool)",
  "function getSubmission(uint256 submissionId) external view returns (address, bytes32, uint256, bool, uint256)",
  "function submissionCount() external view returns (uint256)",
  "event ZKProofVerified(address indexed user, bytes32 vkHash, bool valid)",
  "event CreditDataSubmittedWithProof(address indexed user, uint256 proofId)",
  "event VerifierSet(address indexed verifier)",
  "event CreditEngineSet(address indexed engine)",
] as const
