// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";

contract CreditDelegation is Ownable {

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event DelegationOfferCreated(address indexed delegator, uint256 offerId);
    event DelegationOfferCancelled(address indexed delegator, uint256 offerId);
    event DelegationAccepted(address indexed delegator, address indexed borrower, uint256 offerId, uint256 bondId);
    event DelegationRepaid(address indexed borrower, uint256 bondId);
    event DelegationDefaulted(address indexed delegator, address indexed borrower, uint256 bondId);
    event CreditEngineSet(address indexed engine);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error OfferNotFound();
    error OfferNotActive();
    error BondNotFound();
    error NotDelegator();
    error CircularDelegation();
    error SelfDelegation();
    error OfferExhausted();
    error MaxBondsReached();

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
        Defaulted
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct DelegationOffer {
        address delegator;
        uint256 maxDelegatedAmount;
        uint256 yieldRate;
        uint256 minCreditScore;
        uint256 totalDelegated;
        uint256 availableAmount;
        uint256 maxBonds;
        uint256 activeBondCount;
        OfferStatus status;
        uint256 createdAt;
    }

    struct DelegationBond {
        address delegator;
        address borrower;
        uint256 offerId;
        uint256 delegatedAmount;
        uint256 borrowedAmount;
        uint256 repaidAmount;
        uint256 accumulatedYield;
        uint256 yieldRate;
        uint256 createdAt;
        BondStatus status;
    }

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────

    DelegationOffer[] private offers;
    DelegationBond[] private bonds;
    mapping(address => uint256[]) private delegatorOffers;
    mapping(address => uint256[]) private borrowerBonds;

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(address _owner) Ownable(_owner) {
    }

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
            delegator: msg.sender,
            maxDelegatedAmount: _maxAmount,
            yieldRate: _yieldRate,
            minCreditScore: _minScore,
            totalDelegated: 0,
            availableAmount: _maxAmount,
            maxBonds: _maxBonds,
            activeBondCount: 0,
            status: OfferStatus.Active,
            createdAt: block.timestamp
        }));

        uint256 offerId = offers.length - 1;
        delegatorOffers[msg.sender].push(offerId);

        emit DelegationOfferCreated(msg.sender, offerId);
    }

    function cancelOffer(uint256 _offerId) external {
        if (_offerId >= offers.length) revert OfferNotFound();
        
        DelegationOffer storage offer = offers[_offerId];
        if (offer.delegator != msg.sender) revert NotDelegator();
        if (offer.status != OfferStatus.Active) revert OfferNotActive();

        offer.status = OfferStatus.Cancelled;
        emit DelegationOfferCancelled(msg.sender, _offerId);
    }

    function acceptOffer(uint256 _offerId, uint256 _amount, uint256 _duration) external {
        if (_offerId >= offers.length) revert OfferNotFound();

        DelegationOffer storage offer = offers[_offerId];
        if (offer.status != OfferStatus.Active) revert OfferNotActive();
        if (offer.delegator == msg.sender) revert SelfDelegation();
        if (offer.availableAmount < _amount) revert OfferExhausted();
        if (offer.activeBondCount >= offer.maxBonds) revert MaxBondsReached();

        uint256 yieldShare = (_amount * offer.yieldRate) / 10000;

        bonds.push(DelegationBond({
            delegator: offer.delegator,
            borrower: msg.sender,
            offerId: _offerId,
            delegatedAmount: _amount,
            borrowedAmount: 0,
            repaidAmount: 0,
            accumulatedYield: 0,
            yieldRate: yieldShare,
            createdAt: block.timestamp,
            status: BondStatus.Active
        }));

        uint256 bondId = bonds.length - 1;
        borrowerBonds[msg.sender].push(bondId);

        offer.totalDelegated += _amount;
        offer.availableAmount -= _amount;
        offer.activeBondCount++;

        emit DelegationAccepted(offer.delegator, msg.sender, _offerId, bondId);
    }

    // ──────────────────────────────────────────────
    //  Bond Functions
    // ──────────────────────────────────────────────

    function repayBond(uint256 _bondId) external payable {
        if (_bondId >= bonds.length) revert BondNotFound();

        DelegationBond storage bond = bonds[_bondId];
        if (bond.borrower != msg.sender) revert NotDelegator();
        if (bond.status != BondStatus.Active) revert BondNotFound();
        if (msg.value == 0) revert BondNotFound();

        bond.repaidAmount += msg.value;
        bond.accumulatedYield += (msg.value * bond.yieldRate) / 10000;

        if (bond.repaidAmount >= bond.delegatedAmount) {
            bond.status = BondStatus.Repaid;
            
            DelegationOffer storage offer = offers[bond.offerId];
            offer.activeBondCount--;
            offer.availableAmount += bond.delegatedAmount;

            emit DelegationRepaid(msg.sender, _bondId);
        }
    }

    function markDefaulted(uint256 _bondId) external {
        if (_bondId >= bonds.length) revert BondNotFound();

        DelegationBond storage bond = bonds[_bondId];
        if (bond.status != BondStatus.Active) revert BondNotFound();

        bond.status = BondStatus.Defaulted;

        DelegationOffer storage offer = offers[bond.offerId];
        offer.activeBondCount--;

        emit DelegationDefaulted(bond.delegator, bond.borrower, _bondId);
    }

    // ──────────────────────────────────────────────
    //  View Functions
    // ──────────────────────────────────────────────

    function offerCount() external view returns (uint256) {
        return offers.length;
    }

    function bondCount() external view returns (uint256) {
        return bonds.length;
    }

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
        
        DelegationOffer storage offer = offers[_offerId];
        return (
            offer.delegator,
            offer.maxDelegatedAmount,
            offer.yieldRate,
            offer.minCreditScore,
            offer.availableAmount,
            offer.activeBondCount,
            offer.maxBonds,
            uint256(offer.status)
        );
    }

    function getOfferStatus(uint256 _offerId) external view returns (uint256) {
        if (_offerId >= offers.length) revert OfferNotFound();
        return uint256(offers[_offerId].status);
    }

    function getBond(uint256 _bondId) external view returns (
        address delegator,
        address borrower,
        uint256 amount,
        uint256 repaid,
        uint256 yieldEarned,
        uint256 yieldRate,
        uint256 status
    ) {
        if (_bondId >= bonds.length) revert BondNotFound();
        
        DelegationBond storage bond = bonds[_bondId];
        return (
            bond.delegator,
            bond.borrower,
            bond.delegatedAmount,
            bond.repaidAmount,
            bond.accumulatedYield,
            bond.yieldRate,
            uint256(bond.status)
        );
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
}
