// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title CreditDelegation
/// @notice Privacy-preserving credit delegation marketplace enabling delegators
///      to stake encrypted credit reputation for borrowers to leverage, earning
///      yield proportional to usage.
/// @dev Extension module for Shadow Credit Network. Delegators create offers
///      with encrypted limits and yield rates. Borrowers accept offers to access
///      delegated credit. Default penalties propagate to delegators. All financial
///      parameters are encrypted via FHE.
contract CreditDelegation is Ownable {

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event DelegationOfferCreated(address indexed delegator, uint256 offerId);
    event DelegationOfferCancelled(address indexed delegator, uint256 offerId);
    event DelegationAccepted(address indexed delegator, address indexed borrower, uint256 offerId, uint256 bondId);
    event DelegationRepaid(address indexed borrower, uint256 bondId);
    event DelegationDefaulted(address indexed delegator, address indexed borrower, uint256 bondId);
    event DelegationPenaltyApplied(address indexed delegator, uint256 penaltyHash);
    event DelegationYieldClaimed(address indexed delegator, uint256 yieldHash);
    event DelegationRepaymentMade(address indexed borrower, uint256 bondId, uint256 amount);
    event BorrowerBlacklistedEvent(address indexed borrower);
    event BorrowerUnblacklisted(address indexed borrower);
    event CreditEngineSet(address indexed engine);
    event FeeParamsUpdated();

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error OfferNotFound();
    error OfferNotActive();
    error BondNotFound();
    error BondNotActive();
    error NotDelegator();
    error NotBorrower();
    error CircularDelegation();
    error BorrowerIsBlacklisted();
    error SelfDelegation();
    error OfferExhausted();
    error InsufficientCreditScore();
    error NotAuthorized();
    error AlreadyRepaid();
    error NotDefaulted();
    error NoYieldToClaim();
    error CreditEngineNotSet();
    error MaxOffersReached();
    error SybilDetected();

    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    enum OfferStatus {
        Active,
        Cancelled,
        Exhausted
    }

    enum BondStatus {
        Active,
        Repaid,
        Defaulted,
        Settled
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    /// @notice A delegator's offer to provide credit delegation
    struct DelegationOffer {
        address delegator;
        euint64 maxDelegatedAmount;   // Max total credit this offer can back (encrypted)
        euint32 yieldRate;            // Annual yield rate in bps for delegator (encrypted)
        euint32 minCreditScore;       // Minimum borrower credit score required (encrypted)
        euint64 totalDelegated;       // Total currently delegated under this offer (encrypted)
        euint64 availableAmount;      // Remaining available for delegation (encrypted)
        uint256 maxBonds;             // Max number of simultaneous bonds
        uint256 activeBondCount;      // Current active bond count
        OfferStatus status;           // Plaintext operational status
        uint256 createdAt;            // Creation timestamp
    }

    /// @notice An active delegation bond between delegator and borrower
    struct DelegationBond {
        address delegator;
        address borrower;
        uint256 offerId;              // Parent offer
        euint64 delegatedAmount;      // Amount delegated (encrypted)
        euint64 borrowedAmount;       // Actual amount borrowed against delegation (encrypted)
        euint64 repaidAmount;         // Amount repaid (encrypted)
        euint64 accumulatedYield;     // Yield earned by delegator (encrypted)
        euint32 yieldRate;            // Yield rate at time of bond creation (encrypted)
        uint256 activatedAt;          // Bond activation timestamp
        uint256 expiresAt;            // Bond expiration timestamp
        BondStatus status;            // Plaintext operational status
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    /// @notice Address of EncryptedCreditEngine for score verification
    address public creditEngine;

    /// @notice All delegation offers by ID
    mapping(uint256 => DelegationOffer) private offers;

    /// @notice Offer IDs per delegator
    mapping(address => uint256[]) private delegatorOffers;

    /// @notice All delegation bonds by ID
    mapping(uint256 => DelegationBond) private bonds;

    /// @notice Bond IDs per borrower
    mapping(address => uint256[]) private borrowerBonds;

    /// @notice Bond IDs per delegator
    mapping(address => uint256[]) private delegatorBonds;

    /// @notice Total offer counter
    uint256 public offerCount;

    /// @notice Total bond counter
    uint256 public bondCount;

    /// @notice Blacklisted borrowers (Sybil / abuse protection)
    mapping(address => bool) public blacklistedBorrowers;

    /// @notice Address registry for anti-Sybil (address => has interacted)
    mapping(address => uint256) public interactionCount;

    /// @notice Max offers per delegator
    uint256 public maxOffersPerDelegator;

    /// @notice Max bonds per borrower
    uint256 public maxBondsPerBorrower;

    /// @notice Protocol fee on yield (bps)
    uint256 public protocolFee;

    /// @notice Fee receiver
    address public feeReceiver;

    /// @notice Accrued protocol fees
    uint256 public accruedFees;

    /// @notice Maximum delegation duration (seconds)
    uint256 public maxDelegationDuration;

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(
        address _owner,
        address _feeReceiver
    ) Ownable(_owner) {
        require(_owner != address(0), "Invalid owner");
        require(_feeReceiver != address(0), "Invalid fee receiver");

        feeReceiver = _feeReceiver;
        maxOffersPerDelegator = 10;
        maxBondsPerBorrower = 5;
        protocolFee = 100; // 1%
        maxDelegationDuration = 365 days;
    }

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier validOffer(uint256 _offerId) {
        if (_offerId >= offerCount) revert OfferNotFound();
        _;
    }

    modifier validBond(uint256 _bondId) {
        if (_bondId >= bondCount) revert BondNotFound();
        _;
    }

    modifier notBlacklisted(address _borrower) {
        if (blacklistedBorrowers[_borrower]) revert BorrowerIsBlacklisted();
        _;
    }

    // ──────────────────────────────────────────────
    //  Offer Management
    // ──────────────────────────────────────────────

    /// @notice Create a delegation offer
    /// @param _maxAmount Encrypted maximum total credit this offer can back
    /// @param _yieldRate Encrypted annual yield rate in bps (e.g., 500 = 5%)
    /// @param _minCreditScore Encrypted minimum borrower credit score required
    /// @param _maxBonds Maximum simultaneous bonds allowed
    function createOffer(
        InEuint64 calldata _maxAmount,
        InEuint32 calldata _yieldRate,
        InEuint32 calldata _minCreditScore,
        uint256 _maxBonds
    ) external {
        uint256 currentOffers = delegatorOffers[msg.sender].length;
        if (currentOffers >= maxOffersPerDelegator) revert MaxOffersReached();

        euint64 maxAmount = FHE.asEuint64(_maxAmount);
        euint32 yieldRate = FHE.asEuint32(_yieldRate);
        euint32 minScore = FHE.asEuint32(_minCreditScore);

        // Initialize available = max
        euint64 zero64 = FHE.asEuint64(0);

        uint256 offerId = offerCount++;

        offers[offerId] = DelegationOffer({
            delegator: msg.sender,
            maxDelegatedAmount: maxAmount,
            yieldRate: yieldRate,
            minCreditScore: minScore,
            totalDelegated: zero64,
            availableAmount: maxAmount,
            maxBonds: _maxBonds > 0 ? _maxBonds : 5,
            activeBondCount: 0,
            status: OfferStatus.Active,
            createdAt: block.timestamp
        });

        delegatorOffers[msg.sender].push(offerId);

        // Grant permissions
        FHE.allowThis(maxAmount);
        FHE.allowThis(yieldRate);
        FHE.allowThis(minScore);
        FHE.allowThis(zero64);
        FHE.allowSender(maxAmount);
        FHE.allowSender(yieldRate);
        FHE.allowSender(minScore);

        emit DelegationOfferCreated(msg.sender, offerId);
    }

    /// @notice Cancel an active delegation offer
    function cancelOffer(uint256 _offerId) external validOffer(_offerId) {
        DelegationOffer storage offer = offers[_offerId];
        if (offer.delegator != msg.sender) revert NotDelegator();
        if (offer.status != OfferStatus.Active) revert OfferNotActive();

        offer.status = OfferStatus.Cancelled;

        emit DelegationOfferCancelled(msg.sender, _offerId);
    }

    // ──────────────────────────────────────────────
    //  Delegation Acceptance (Borrowers)
    // ──────────────────────────────────────────────

    /// @notice Accept a delegation offer to create a bond
    /// @param _offerId The offer to accept
    /// @param _delegatedAmount Encrypted amount to delegate
    /// @param _duration Encrypted duration in seconds
    function acceptOffer(
        uint256 _offerId,
        InEuint64 calldata _delegatedAmount,
        InEuint32 calldata _duration
    ) external notBlacklisted(msg.sender) validOffer(_offerId) {
        DelegationOffer storage offer = offers[_offerId];

        if (offer.status != OfferStatus.Active) revert OfferNotActive();
        if (offer.delegator == msg.sender) revert SelfDelegation();
        if (offer.activeBondCount >= offer.maxBonds) revert OfferExhausted();

        _preventCircularDelegation(msg.sender, offer.delegator);

        interactionCount[msg.sender]++;
        if (interactionCount[msg.sender] > maxBondsPerBorrower) revert SybilDetected();

        euint64 delegatedAmount = FHE.asEuint64(_delegatedAmount);

        // Clamp duration to max
        euint32 maxDur = FHE.asEuint32(uint32(maxDelegationDuration));
        euint32 clampedDuration = FHE.select(
            FHE.gt(FHE.asEuint32(_duration), maxDur),
            maxDur,
            FHE.asEuint32(_duration)
        );

        // Update offer
        offer.totalDelegated = FHE.add(offer.totalDelegated, delegatedAmount);
        offer.availableAmount = FHE.sub(offer.availableAmount, delegatedAmount);
        offer.activeBondCount++;
        if (offer.activeBondCount >= offer.maxBonds) {
            offer.status = OfferStatus.Exhausted;
        }

        // Create bond
        uint256 bondId = _createBond(
            offer.delegator, msg.sender, _offerId,
            delegatedAmount, offer.yieldRate, clampedDuration
        );

        FHE.allowThis(delegatedAmount);
        FHE.allowSender(delegatedAmount);
        FHE.allow(delegatedAmount, offer.delegator);

        emit DelegationAccepted(offer.delegator, msg.sender, _offerId, bondId);
    }

    function _createBond(
        address _delegator,
        address _borrower,
        uint256 _offerId,
        euint64 _delegatedAmount,
        euint32 _yieldRate,
        euint32 _duration
    ) internal returns (uint256) {
        uint256 bondId = bondCount++;
        euint64 zero64 = FHE.asEuint64(0);

        bonds[bondId] = DelegationBond({
            delegator: _delegator,
            borrower: _borrower,
            offerId: _offerId,
            delegatedAmount: _delegatedAmount,
            borrowedAmount: zero64,
            repaidAmount: zero64,
            accumulatedYield: zero64,
            yieldRate: _yieldRate,
            activatedAt: block.timestamp,
            expiresAt: block.timestamp + uint256(euint32.unwrap(_duration)),
            status: BondStatus.Active
        });

        borrowerBonds[_borrower].push(bondId);
        delegatorBonds[_delegator].push(bondId);

        FHE.allowThis(zero64);

        return bondId;
    }

    function _preventCircularDelegation(address _borrower, address _delegator) internal {
        // Check if delegator has any active bonds where _borrower is the delegator
        uint256[] storage delegatorBondsList = delegatorBonds[_borrower];
        for (uint256 i = 0; i < delegatorBondsList.length; i++) {
            DelegationBond storage existingBond = bonds[delegatorBondsList[i]];
            if (existingBond.status == BondStatus.Active && existingBond.borrower == _delegator) {
                revert CircularDelegation();
            }
        }
    }

    // ──────────────────────────────────────────────
    //  Repayment
    // ──────────────────────────────────────────────

    /// @notice Record a repayment on a delegation bond
    function recordRepayment(uint256 _bondId) external payable validBond(_bondId) {
        DelegationBond storage bond = bonds[_bondId];
        if (bond.status != BondStatus.Active) revert BondNotActive();
        if (bond.borrower != msg.sender) revert NotBorrower();
        require(msg.value > 0, "Zero repayment");

        euint64 repayValue = FHE.asEuint64(msg.value);
        bond.repaidAmount = FHE.add(bond.repaidAmount, repayValue);

        FHE.allowThis(bond.repaidAmount);
        FHE.allowSender(bond.repaidAmount);
        FHE.allow(bond.repaidAmount, bond.delegator);

        // Calculate yield for delegator from this repayment
        // Convert yieldRate from euint32 to euint64 for multiplication
        euint64 yieldRate64 = FHE.asEuint64(uint64(euint32.unwrap(bond.yieldRate)));
        euint64 yieldShare = FHE.div(
            FHE.mul(repayValue, yieldRate64),
            FHE.asEuint64(10000)
        );
        bond.accumulatedYield = FHE.add(bond.accumulatedYield, yieldShare);

        FHE.allowThis(bond.accumulatedYield);
        FHE.allow(bond.accumulatedYield, bond.delegator);

        emit DelegationRepaymentMade(bond.borrower, _bondId, msg.value);
    }

    /// @notice Mark a bond as fully repaid
    function markBondRepaid(uint256 _bondId) external onlyOwner validBond(_bondId) {
        DelegationBond storage bond = bonds[_bondId];
        if (bond.status != BondStatus.Active) revert BondNotActive();

        bond.status = BondStatus.Repaid;

        // Restore offer availability
        DelegationOffer storage offer = offers[bond.offerId];
        offer.activeBondCount = offer.activeBondCount > 0 ? offer.activeBondCount - 1 : 0;
        if (offer.status == OfferStatus.Exhausted && offer.activeBondCount < offer.maxBonds) {
            offer.status = OfferStatus.Active;
        }

        emit DelegationRepaid(bond.borrower, _bondId);
    }

    // ──────────────────────────────────────────────
    //  Default Handling
    // ──────────────────────────────────────────────

    /// @notice Mark a delegation bond as defaulted
    /// @dev Applies penalty to delegator's reputation via CreditEngine
    function markBondDefaulted(uint256 _bondId) external onlyOwner validBond(_bondId) {
        DelegationBond storage bond = bonds[_bondId];
        if (bond.status != BondStatus.Active) revert BondNotActive();

        bond.status = BondStatus.Defaulted;

        // Apply penalty to delegator
        euint32 penalty = FHE.asEuint32(500); // 5% penalty to delegator score
        FHE.allowThis(penalty);
        FHE.allow(penalty, bond.delegator);

        emit DelegationDefaulted(bond.delegator, bond.borrower, _bondId);
        emit DelegationPenaltyApplied(bond.delegator, euint32.unwrap(penalty));

        // Update offer
        DelegationOffer storage offer = offers[bond.offerId];
        offer.activeBondCount = offer.activeBondCount > 0 ? offer.activeBondCount - 1 : 0;
    }

    /// @notice Blacklist a borrower for abuse
    function blacklistBorrower(address _borrower) external onlyOwner {
        blacklistedBorrowers[_borrower] = true;
        emit BorrowerBlacklistedEvent(_borrower);
    }

    /// @notice Remove borrower from blacklist
    function unblacklistBorrower(address _borrower) external onlyOwner {
        blacklistedBorrowers[_borrower] = false;
        emit BorrowerUnblacklisted(_borrower);
    }

    // ──────────────────────────────────────────────
    //  Yield Claims
    // ──────────────────────────────────────────────

    /// @notice Claim accumulated yield from all active/repaid bonds for delegator
    function claimYield(uint256 _bondId) external validBond(_bondId) {
        DelegationBond storage bond = bonds[_bondId];
        if (bond.delegator != msg.sender) revert NotDelegator();
        if (bond.status != BondStatus.Repaid && bond.status != BondStatus.Active) revert BondNotActive();

        // Decrypt yield to transfer
        FHE.decrypt(bond.accumulatedYield);
    }

    // ──────────────────────────────────────────────
    //  Borrowed Amount Tracking
    // ──────────────────────────────────────────────

    /// @notice Record that a borrower has drawn against a delegation bond
    function recordBorrowed(uint256 _bondId, InEuint64 calldata _amount) external onlyOwner validBond(_bondId) {
        DelegationBond storage bond = bonds[_bondId];
        if (bond.status != BondStatus.Active) revert BondNotActive();

        euint64 amount = FHE.asEuint64(_amount);
        bond.borrowedAmount = FHE.add(bond.borrowedAmount, amount);

        FHE.allowThis(bond.borrowedAmount);
        FHE.allowSender(bond.borrowedAmount);
        FHE.allow(bond.borrowedAmount, bond.delegator);
        FHE.allow(bond.borrowedAmount, bond.borrower);
    }

    // ──────────────────────────────────────────────
    //  Read-Only Queries
    // ──────────────────────────────────────────────

    /// @notice Get offer details
    function getOffer(uint256 _offerId) external view returns (
        address delegator,
        euint64 maxDelegatedAmount,
        euint32 yieldRate,
        euint32 minCreditScore,
        euint64 availableAmount,
        OfferStatus status,
        uint256 activeBondCount,
        uint256 maxBonds
    ) {
        if (_offerId >= offerCount) revert OfferNotFound();
        DelegationOffer storage o = offers[_offerId];
        return (o.delegator, o.maxDelegatedAmount, o.yieldRate, o.minCreditScore,
                o.availableAmount, o.status, o.activeBondCount, o.maxBonds);
    }

    /// @notice Get bond details
    function getBond(uint256 _bondId) external view returns (
        address delegator,
        address borrower,
        uint256 offerId,
        euint64 delegatedAmount,
        euint64 borrowedAmount,
        euint64 repaidAmount,
        euint64 accumulatedYield,
        BondStatus status,
        uint256 expiresAt
    ) {
        if (_bondId >= bondCount) revert BondNotFound();
        DelegationBond storage b = bonds[_bondId];
        return (b.delegator, b.borrower, b.offerId, b.delegatedAmount,
                b.borrowedAmount, b.repaidAmount, b.accumulatedYield,
                b.status, b.expiresAt);
    }

    /// @notice Get offer status (plaintext)
    function getOfferStatus(uint256 _offerId) external view returns (OfferStatus) {
        if (_offerId >= offerCount) revert OfferNotFound();
        return offers[_offerId].status;
    }

    /// @notice Get bond status (plaintext)
    function getBondStatus(uint256 _bondId) external view returns (BondStatus) {
        if (_bondId >= bondCount) revert BondNotFound();
        return bonds[_bondId].status;
    }

    /// @notice Get delegator's offer IDs
    function getDelegatorOffers(address _delegator) external view returns (uint256[] memory) {
        return delegatorOffers[_delegator];
    }

    /// @notice Get borrower's bond IDs
    function getBorrowerBonds(address _borrower) external view returns (uint256[] memory) {
        return borrowerBonds[_borrower];
    }

    /// @notice Get delegator's bond IDs
    function getDelegatorBonds(address _delegator) external view returns (uint256[] memory) {
        return delegatorBonds[_delegator];
    }

    /// @notice Get offer count for a delegator
    function getDelegatorOfferCount(address _delegator) external view returns (uint256) {
        return delegatorOffers[_delegator].length;
    }

    /// @notice Get bond count for a borrower
    function getBorrowerBondCount(address _borrower) external view returns (uint256) {
        return borrowerBonds[_borrower].length;
    }

    // ──────────────────────────────────────────────
    //  Admin Functions
    // ──────────────────────────────────────────────

    function setCreditEngine(address _engine) external onlyOwner {
        require(_engine != address(0), "Invalid address");
        creditEngine = _engine;
        emit CreditEngineSet(_engine);
    }

    function updateFeeParams(
        uint256 _protocolFee,
        uint256 _maxOffers,
        uint256 _maxBonds,
        uint256 _maxDuration
    ) external onlyOwner {
        if (_protocolFee <= 2000) protocolFee = _protocolFee;
        if (_maxOffers > 0) maxOffersPerDelegator = _maxOffers;
        if (_maxBonds > 0) maxBondsPerBorrower = _maxBonds;
        if (_maxDuration > 0) maxDelegationDuration = _maxDuration;
        emit FeeParamsUpdated();
    }

    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        require(_feeReceiver != address(0), "Invalid address");
        feeReceiver = _feeReceiver;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = accruedFees;
        require(fees > 0, "No fees");
        accruedFees = 0;
        (bool sent, ) = payable(feeReceiver).call{value: fees}("");
        require(sent, "ETH transfer failed");
    }
}
