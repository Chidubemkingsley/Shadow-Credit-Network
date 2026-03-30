// EncryptedCreditEngine ABI (minimal)
export const CREDIT_ENGINE_ABI = [
  "function register() external",
  "function isRegistered(address) external view returns (bool)",
  "function submitCreditData(tuple(uint256) income, tuple(uint256) totalDebt, tuple(uint256) paymentHistory, tuple(uint256) creditUtilization, tuple(uint256) accountAge, tuple(uint256) numDefaults) external",
  "function computeCreditScore() external",
  "function computeBorrowingPower() external",
  "function hasComputedScore(address) external view returns (bool)",
  "function requestScoreDecryption() external",
  "function getDecryptedScoreSafe() external view returns (uint32, bool)",
  "function getCreditScore(address) external view returns (tuple(uint256))",
  "function getRiskTier(address) external view returns (tuple(uint256))",
  "function authorizeDelegate(address delegate, tuple(uint256) creditLimit) external",
  "function revokeDelegate(address delegate) external",
  "function isDelegationActive(address, address) external view returns (bool)",
  "function getDelegateCount(address) external view returns (uint256)",
  "function getDelegateAtIndex(address, uint256) external view returns (address)",
  "event UserRegistered(address indexed user)",
  "event CreditDataSubmitted(address indexed user, uint256 ciphertextHash)",
  "event CreditScoreComputed(address indexed user, uint256 scoreHash)",
  "event DelegateAuthorized(address indexed user, address indexed delegate)",
  "event DelegateRevoked(address indexed user, address indexed delegate)",
] as const

// PrivateLoanPool ABI (minimal)
export const LOAN_POOL_ABI = [
  "function fundPool() external payable",
  "function withdrawFunds(uint256 amount) external",
  "function totalPoolLiquidity() external view returns (uint256)",
  "function getAvailableLiquidity() external view returns (uint256)",
  "function requestLoan(tuple(uint256) principal, tuple(uint256) duration, uint8 riskPool) external",
  "function repayLoan(uint256 loanId) external payable",
  "function getLoan(uint256) external view returns (address, tuple(uint256), tuple(uint256), tuple(uint256), tuple(uint256), uint8, uint256)",
  "function getLoanStatus(uint256) external view returns (uint8)",
  "function getBorrowerLoans(address) external view returns (uint256[])",
  "function loanCount() external view returns (uint256)",
  "function getLenderDeposit(address) external view returns (uint256, uint256, tuple(uint256))",
  "function getLenderCount() external view returns (uint256)",
  "event PoolFunded(address indexed lender, uint256 amount)",
  "event LoanRequested(address indexed borrower, uint256 loanId)",
  "event RepaymentMade(address indexed borrower, uint256 loanId, uint256 amount)",
] as const

// CreditDelegation ABI (minimal)
export const DELEGATION_ABI = [
  "function createOffer(tuple(uint256) maxAmount, tuple(uint256) yieldRate, tuple(uint256) minCreditScore, uint256 maxBonds) external",
  "function cancelOffer(uint256 offerId) external",
  "function acceptOffer(uint256 offerId, tuple(uint256) amount, tuple(uint256) duration) external",
  "function getOffer(uint256) external view returns (address, tuple(uint256), tuple(uint256), tuple(uint256), tuple(uint256), uint8, uint256, uint256)",
  "function getOfferStatus(uint256) external view returns (uint8)",
  "function getBond(uint256) external view returns (address, address, uint256, tuple(uint256), tuple(uint256), tuple(uint256), tuple(uint256), uint8, uint256)",
  "function getBondStatus(uint256) external view returns (uint8)",
  "function offerCount() external view returns (uint256)",
  "function bondCount() external view returns (uint256)",
  "function getBorrowerBonds(address) external view returns (uint256[])",
  "function getDelegatorOffers(address) external view returns (uint256[])",
  "event DelegationOfferCreated(address indexed delegator, uint256 offerId)",
  "event DelegationAccepted(address indexed delegator, address indexed borrower, uint256 offerId, uint256 bondId)",
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
