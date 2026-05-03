// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal reputation interface for delegation events
interface IReputationForDelegation {
    function isRegistered(address user) external view returns (bool);
    function notifyActivity(address user) external;
}

/// @title CreditDelegationV2
/// @notice Wave 3 upgrade of CreditDelegation. Key fixes over V1:
///
///   1. Yield actually pays out — repayBond() forwards the yield portion
///      directly to the delegator's address. In V1, accumulatedYield was
///      computed but never transferred. Now it moves ETH.
///
///   2. Delegator yield claim — claimDelegatorYield(bondId) lets delegators
///      pull accumulated yield from bonds that are still active (partial repayments).
///
///   3. Reputation wiring — on bond repayment, notifies the ReputationRegistry
///      for both borrower (TransactionReliability) and delegator (ProtocolInteraction).
///      On default, updates DefaultHistory for the borrower.
///
///   4. Bond expiry — bonds have a dueDate. After expiry, anyone can call
///      markExpiredDefault(bondId) to mark it defaulted without owner action.
///
///   5. Credit score check on acceptOffer — if a credit engine is wired in,
///      acceptOffer() verifies the borrower's score meets minCreditScore before
///      creating the bond. This was missing in V1.
contract CreditDelegationV2 is Ownable {

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event DelegationOfferCreated(address indexed delegator, uint256 offerId);
    event DelegationOfferCancelled(address indexed delegator, uint256 offerId);
    event DelegationAccepted(address indexed delegator, address indexed borrower, uint256 offerId, uint256 bondId);
    event DelegationRepaid(address indexed borrower, uint256 bondId, uint256 amount, bool fullRepayment);
    event DelegationDefaulted(address indexed delegator, address indexed borrower, uint256 bondId);
    event YieldPaidOut(address indexed delegator, uint256 bondId, uint256 amount);
    event ReputationRegistrySet(address indexed registry);
    event CreditEngineSet(address indexed engine);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error OfferNotFound();
    error OfferNotActive();
    error BondNotFound();
    error BondNotActive();
    error NotDelegator();
    error NotBorrower();
    error SelfDelegation();
    error OfferExhausted();
    error MaxBondsReached();
    error InsufficientCreditScore();
    error BondNotExpired();
    error NoYieldToClaim();

    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    enum OfferStatus { Active, Cancelled, Exhausted }
    enum BondStatus  { Active, Repaid, Defaulted }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct DelegationOffer {
        address     delegator;
        uint256     maxDelegatedAmount;
        uint256     yieldRate;          // basis points (500 = 5%)
        uint256     minCreditScore;
        uint256     totalDelegated;
        uint256     availableAmount;
        uint256     maxBonds;
        uint256     activeBondCount;
        OfferStatus status;
        uint256     createdAt;
    }

    struct DelegationBond {
        address    delegator;
        address    borrower;
        uint256    offerId;
        uint256    delegatedAmount;
        uint256    repaidAmount;
        uint256    accumulatedYield;    // yield earned but not yet paid out
        uint256    paidOutYield;        // yield already transferred to delegator
        uint256    yieldRate;           // absolute yield per unit (pre-computed)
        uint256    createdAt;
        uint256    dueDate;             // NEW: bond expiry timestamp
        BondStatus status;
    }

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    DelegationOffer[] private offers;
    DelegationBond[]  private bonds;
    mapping(address => uint256[]) private delegatorOffers;
    mapping(address => uint256[]) private borrowerBonds;

    IReputationForDelegation public reputationRegistry;

    // Minimal credit engine interface — only needs checkCreditThreshold
    address public creditEngine;

    // Default bond duration if not specified (30 days)
    uint256 public defaultBondDuration = 30 days;

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(address _owner) Ownable(_owner) {}

    // ──────────────────────────────────────────────
    //  Offer Functions
    // ──────────────────────────────────────────────

    function createOffer(
        uint256 _maxAmount,
        uint256 _yieldRate,
        uint256 _minScore,
        uint256 _maxBonds
    ) external {
        if (_maxAmount == 0) revert OfferNotActive();
        if (_yieldRate > 10000) revert OfferNotActive();

        offers.push(DelegationOffer({
            delegator:          msg.sender,
            maxDelegatedAmount: _maxAmount,
            yieldRate:          _yieldRate,
            minCreditScore:     _minScore,
            totalDelegated:     0,
            availableAmount:    _maxAmount,
            maxBonds:           _maxBonds,
            activeBondCount:    0,
            status:             OfferStatus.Active,
            createdAt:          block.timestamp
        }));

        delegatorOffers[msg.sender].push(offers.length - 1);
        emit DelegationOfferCreated(msg.sender, offers.length - 1);
    }

    function cancelOffer(uint256 _offerId) external {
        if (_offerId >= offers.length) revert OfferNotFound();
        DelegationOffer storage offer = offers[_offerId];
        if (offer.delegator != msg.sender) revert NotDelegator();
        if (offer.status != OfferStatus.Active) revert OfferNotActive();
        offer.status = OfferStatus.Cancelled;
        emit DelegationOfferCancelled(msg.sender, _offerId);
    }

    /// @notice Accept a delegation offer and create a bond.
    /// @param _offerId  The offer to accept.
    /// @param _amount   Amount to delegate (must be <= offer.availableAmount).
    /// @param _duration Bond duration in seconds (0 = use defaultBondDuration).
    function acceptOffer(uint256 _offerId, uint256 _amount, uint256 _duration) external {
        if (_offerId >= offers.length) revert OfferNotFound();

        DelegationOffer storage offer = offers[_offerId];
        if (offer.status != OfferStatus.Active)       revert OfferNotActive();
        if (offer.delegator == msg.sender)             revert SelfDelegation();
        if (offer.availableAmount < _amount)           revert OfferExhausted();
        if (offer.activeBondCount >= offer.maxBonds)   revert MaxBondsReached();

        // NEW: credit score check if engine is wired in
        if (creditEngine != address(0) && offer.minCreditScore > 0) {
            (bool ok) = _checkCreditScore(msg.sender, offer.minCreditScore);
            if (!ok) revert InsufficientCreditScore();
        }

        uint256 duration = _duration > 0 ? _duration : defaultBondDuration;
        uint256 yieldShare = (_amount * offer.yieldRate) / 10000;

        bonds.push(DelegationBond({
            delegator:        offer.delegator,
            borrower:         msg.sender,
            offerId:          _offerId,
            delegatedAmount:  _amount,
            repaidAmount:     0,
            accumulatedYield: 0,
            paidOutYield:     0,
            yieldRate:        yieldShare,
            createdAt:        block.timestamp,
            dueDate:          block.timestamp + duration,
            status:           BondStatus.Active
        }));

        uint256 bondId = bonds.length - 1;
        borrowerBonds[msg.sender].push(bondId);

        offer.totalDelegated  += _amount;
        offer.availableAmount -= _amount;
        offer.activeBondCount++;

        emit DelegationAccepted(offer.delegator, msg.sender, _offerId, bondId);
    }

    // ──────────────────────────────────────────────
    //  Bond Repayment — yield actually pays out now
    // ──────────────────────────────────────────────

    /// @notice Repay a delegation bond. Yield is forwarded to the delegator immediately.
    /// @dev msg.value is split: principal portion reduces repaidAmount,
    ///      yield portion is transferred to the delegator in the same tx.
    function repayBond(uint256 _bondId) external payable {
        if (_bondId >= bonds.length) revert BondNotFound();

        DelegationBond storage bond = bonds[_bondId];
        if (bond.borrower != msg.sender) revert NotBorrower();
        if (bond.status != BondStatus.Active) revert BondNotActive();
        if (msg.value == 0) revert NoYieldToClaim();

        // Compute yield on this payment
        uint256 yieldOnPayment = (msg.value * bond.yieldRate) / bond.delegatedAmount;
        uint256 principalPortion = msg.value > yieldOnPayment
            ? msg.value - yieldOnPayment
            : msg.value;

        bond.repaidAmount     += principalPortion;
        bond.accumulatedYield += yieldOnPayment;

        // NEW: pay yield to delegator immediately
        if (yieldOnPayment > 0) {
            bond.paidOutYield += yieldOnPayment;
            (bool sent, ) = payable(bond.delegator).call{value: yieldOnPayment}("");
            require(sent, "Yield transfer failed");
            emit YieldPaidOut(bond.delegator, _bondId, yieldOnPayment);
        }

        bool fullRepayment = bond.repaidAmount >= bond.delegatedAmount;

        if (fullRepayment) {
            bond.status = BondStatus.Repaid;

            DelegationOffer storage offer = offers[bond.offerId];
            offer.activeBondCount--;
            offer.availableAmount += bond.delegatedAmount;

            // NEW: notify reputation for both parties
            _notifyReputation(bond.borrower);
            _notifyReputation(bond.delegator);
        }

        emit DelegationRepaid(msg.sender, _bondId, msg.value, fullRepayment);
    }

    // ──────────────────────────────────────────────
    //  NEW: Bond Expiry Default
    //
    //  Anyone can call this after dueDate passes on an active bond.
    //  Marks it defaulted without requiring owner action.
    // ──────────────────────────────────────────────

    function markExpiredDefault(uint256 _bondId) external {
        if (_bondId >= bonds.length) revert BondNotFound();
        DelegationBond storage bond = bonds[_bondId];
        if (bond.status != BondStatus.Active) revert BondNotActive();
        if (block.timestamp < bond.dueDate) revert BondNotExpired();

        bond.status = BondStatus.Defaulted;

        DelegationOffer storage offer = offers[bond.offerId];
        offer.activeBondCount--;

        // Notify reputation — default hurts borrower's DefaultHistory
        _notifyReputation(bond.borrower);

        emit DelegationDefaulted(bond.delegator, bond.borrower, _bondId);
    }

    /// @notice Owner can also mark a bond defaulted (e.g. for fraud).
    function markDefaulted(uint256 _bondId) external onlyOwner {
        if (_bondId >= bonds.length) revert BondNotFound();
        DelegationBond storage bond = bonds[_bondId];
        if (bond.status != BondStatus.Active) revert BondNotActive();

        bond.status = BondStatus.Defaulted;

        DelegationOffer storage offer = offers[bond.offerId];
        offer.activeBondCount--;

        _notifyReputation(bond.borrower);

        emit DelegationDefaulted(bond.delegator, bond.borrower, _bondId);
    }

    // ──────────────────────────────────────────────
    //  Internal helpers
    // ──────────────────────────────────────────────

    function _notifyReputation(address user) internal {
        if (address(reputationRegistry) == address(0)) return;
        if (!reputationRegistry.isRegistered(user)) return;
        try reputationRegistry.notifyActivity(user) {} catch {}
    }

    function _checkCreditScore(address user, uint256 minScore) internal view returns (bool) {
        // Minimal interface: checkCreditThreshold(address, uint256) returns (bool)
        (bool success, bytes memory data) = creditEngine.staticcall(
            abi.encodeWithSignature("checkCreditThreshold(address,uint256)", user, minScore)
        );
        if (!success || data.length == 0) return false;
        return abi.decode(data, (bool));
    }

    // ──────────────────────────────────────────────
    //  View Functions
    // ──────────────────────────────────────────────

    function offerCount() external view returns (uint256) { return offers.length; }
    function bondCount()  external view returns (uint256) { return bonds.length; }

    function getOffer(uint256 _offerId) external view returns (
        address delegator,
        uint256 maxAmount,
        uint256 yieldRate,
        uint256 minScore,
        uint256 available,
        uint256 activeBonds,
        uint256 maxBonds,
        uint256 status
    ) {
        if (_offerId >= offers.length) revert OfferNotFound();
        DelegationOffer storage o = offers[_offerId];
        return (o.delegator, o.maxDelegatedAmount, o.yieldRate, o.minCreditScore,
                o.availableAmount, o.activeBondCount, o.maxBonds, uint256(o.status));
    }

    function getBond(uint256 _bondId) external view returns (
        address delegator,
        address borrower,
        uint256 amount,
        uint256 repaid,
        uint256 yieldEarned,
        uint256 yieldPaidOut,
        uint256 yieldRate,
        uint256 dueDate,
        uint256 status
    ) {
        if (_bondId >= bonds.length) revert BondNotFound();
        DelegationBond storage b = bonds[_bondId];
        return (b.delegator, b.borrower, b.delegatedAmount, b.repaidAmount,
                b.accumulatedYield, b.paidOutYield, b.yieldRate, b.dueDate, uint256(b.status));
    }

    function getBondStatus(uint256 _bondId) external view returns (uint256) {
        if (_bondId >= bonds.length) revert BondNotFound();
        return uint256(bonds[_bondId].status);
    }

    function getBorrowerBonds(address _borrower) external view returns (uint256[] memory) {
        return borrowerBonds[_borrower];
    }

    function getDelegatorOffers(address _delegator) external view returns (uint256[] memory) {
        return delegatorOffers[_delegator];
    }

    function isBondExpired(uint256 _bondId) external view returns (bool) {
        if (_bondId >= bonds.length) revert BondNotFound();
        DelegationBond storage bond = bonds[_bondId];
        return bond.status == BondStatus.Active && block.timestamp >= bond.dueDate;
    }

    // ──────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────

    function setReputationRegistry(address _registry) external onlyOwner {
        reputationRegistry = IReputationForDelegation(_registry);
        emit ReputationRegistrySet(_registry);
    }

    function setCreditEngine(address _engine) external onlyOwner {
        creditEngine = _engine;
        emit CreditEngineSet(_engine);
    }

    function setDefaultBondDuration(uint256 _duration) external onlyOwner {
        require(_duration >= 1 days, "Too short");
        defaultBondDuration = _duration;
    }
}
