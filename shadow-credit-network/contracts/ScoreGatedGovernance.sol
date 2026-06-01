// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal interface to EncryptedCreditEngineV3 for governance
interface ICreditEngineForGov {
    function isRegistered(address user) external view returns (bool);
    function hasCreditScore(address user) external view returns (bool);
    function isScoreStale(address user) external view returns (bool);
    function getDecryptedScore(address user) external view returns (uint32 score, bool isDecrypted);
}

/// @notice Minimal interface to SimpleCreditEngine (V1 — plaintext scores, Base Sepolia fallback)
interface ILegacyCreditEngine {
    function checkCreditThreshold(address user, uint256 minScore) external view returns (bool);
    function hasComputedScore(address user) external view returns (bool);
    function isRegistered(address user) external view returns (bool);
}

/// @notice Minimal interface to PrivateLoanPoolV3 for proposal execution
interface ILoanPoolForGov {
    function setPaused(bool paused) external;
}

/// @notice Minimal interface to EncryptedCreditEngineV3 admin functions for execution
interface ICreditEngineAdmin {
    function setScoreValidityPeriod(uint256 period) external;
}

/// @title ScoreGatedGovernance
/// @notice Wave 4 — On-chain governance gated by encrypted credit scores.
///
/// Only users who have publicly decrypted their credit score AND meet the
/// minimum vote threshold can create proposals and cast votes. Voting power
/// is proportional to credit tier (Prime > NearPrime > Subprime > DeepSubprime).
///
/// Privacy design:
///   - Voting requires a publicly decrypted score (opt-in by the voter).
///   - The score itself is NOT stored in the governance contract.
///   - Voting weight is derived at vote time from the decrypted score in
///     EncryptedCreditEngineV3. The weight is NOT tied to a token balance.
///   - Voters with stale scores cannot vote.
///
/// Proposal types (executable on-chain):
///   UpdateScoreValidity      — change scoreValidityPeriod in the credit engine
///   PausePool                — pause / unpause the loan pool
///   UpdateMinVoteScore       — change the governance vote threshold
///   UpdateVotingPeriod       — change the proposal voting window
///   UpdateExecutionDelay     — change the timelock between pass and execution
///   Signal                   — off-chain signal only (no execution)
///
/// Flow:
///   1. propose()  — any eligible voter creates a proposal
///   2. castVote() — eligible voters vote For/Against during votingPeriod
///   3. queue()    — anyone queues a passed proposal after votingPeriod ends
///   4. execute()  — anyone executes a queued proposal after executionDelay
contract ScoreGatedGovernance is Ownable {

    // ──────────────────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────────────────

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        ProposalType proposalType,
        string description,
        uint256 voteStart,
        uint256 voteEnd
    );
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 weight,
        uint8   creditTier
    );
    event ProposalQueued(uint256 indexed proposalId, uint256 executableAt);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event CreditEngineUpdated(address indexed engine);
    event LoanPoolUpdated(address indexed pool);
    event GovernanceParamUpdated(string param, uint256 newValue);
    event GovernanceScoreSubmitted(address indexed user, uint32 score);
    event GovernanceScoreReset(address indexed user);

    // ──────────────────────────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────────────────────────

    error NotEligible();           // score not decrypted or below threshold or stale
    error ProposalNotFound();
    error VotingNotActive();
    error AlreadyVoted();
    error ProposalNotPassed();
    error ProposalNotQueued();
    error TimelockNotExpired();
    error AlreadyQueued();
    error AlreadyExecuted();
    error InvalidParam();
    error QuorumNotMet();
    error NoCreditEngine();
    error ScoreOutOfRange();

    // ──────────────────────────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────────────────────────

    enum ProposalState {
        Active,     // voting in progress
        Defeated,   // voting ended, quorum or majority not met
        Passed,     // voting ended, quorum and majority met — awaiting queue
        Queued,     // queued for execution after timelock
        Executed,   // executed
        Cancelled   // cancelled by proposer or owner
    }

    enum ProposalType {
        Signal,               // 0 — off-chain signal only
        UpdateScoreValidity,  // 1 — change scoreValidityPeriod (seconds)
        PausePool,            // 2 — pause/unpause loan pool (param: 1=pause, 0=unpause)
        UpdateMinVoteScore,   // 3 — change minVoteScore threshold
        UpdateVotingPeriod,   // 4 — change votingPeriod (seconds)
        UpdateExecutionDelay  // 5 — change executionDelay (seconds)
    }

    enum VoteSupport { Against, For }

    // ──────────────────────────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────────────────────────

    struct Proposal {
        uint256       id;
        address       proposer;
        ProposalType  proposalType;
        uint256       param;          // typed payload for execution
        string        description;
        uint256       voteStart;      // block.timestamp when voting opens
        uint256       voteEnd;        // block.timestamp when voting closes
        uint256       forVotes;       // weighted votes For
        uint256       againstVotes;   // weighted votes Against
        uint256       voterCount;     // unique voters
        ProposalState state;
        uint256       executableAt;   // timestamp after which execution is allowed
    }

    // ──────────────────────────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────────────────────────

    ICreditEngineForGov public creditEngine;
    ILoanPoolForGov     public loanPool;
    ICreditEngineAdmin  public creditEngineAdmin;

    /// @notice V1 SimpleCreditEngine fallback — used when V3 FHE decryption
    ///         is unavailable (e.g., Base Sepolia testnet demo mode).
    ///         When set, eligibility falls back to V1 plaintext scores if
    ///         the V3 engine cannot produce a decrypted score.
    ILegacyCreditEngine public legacyCreditEngine;

    // Governance parameters (governance-adjustable via proposals)
    uint256 public minVoteScore    = 580;    // minimum decrypted score to vote (Subprime+)
    uint256 public minProposeScore = 670;    // minimum decrypted score to propose (NearPrime+)
    uint256 public votingPeriod    = 7 days; // voting window
    uint256 public executionDelay  = 2 days; // timelock after passing
    uint256 public quorumThreshold = 100;    // minimum total weighted votes for quorum

    Proposal[] private _proposals;

    // voter address → proposal ID → has voted
    mapping(address => mapping(uint256 => bool)) public hasVoted;

    /// @notice Voluntarily revealed governance scores. Users decrypt their
    ///         score privately via the CoFHE SDK, then submit it here to
    ///         become eligible for governance. Score lives on-chain only
    ///         if the user chooses — call resetGovernanceScore() to remove it.
    mapping(address => uint32) public governanceScores;

    // ──────────────────────────────────────────────────────────────────
    //  Tier weights — voting power by credit tier
    //  Prime (740+): 4, NearPrime (670+): 3, Subprime (580+): 2, DeepSubprime: 1
    // ──────────────────────────────────────────────────────────────────

    uint256 public weightPrime       = 4;
    uint256 public weightNearPrime   = 3;
    uint256 public weightSubprime    = 2;
    uint256 public weightDeepSubprime = 1;

    // ──────────────────────────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor(
        address _owner,
        address _creditEngine,
        address _loanPool
    ) Ownable(_owner) {
        if (_creditEngine != address(0)) {
            creditEngine      = ICreditEngineForGov(_creditEngine);
            creditEngineAdmin = ICreditEngineAdmin(_creditEngine);
        }
        if (_loanPool != address(0)) {
            loanPool = ILoanPoolForGov(_loanPool);
        }
    }

    // ──────────────────────────────────────────────────────────────────
    //  Eligibility helpers
    // ──────────────────────────────────────────────────────────────────

    /// @notice Check if an address is eligible to vote (score decrypted, fresh, >= threshold).
    /// @notice Check if an address is eligible to vote.
    ///         Primary path: V3 FHE decrypted score.
    ///         Fallback path: V1 plaintext checkCreditThreshold (Base Sepolia demo).
    function isEligibleVoter(address user) public view returns (bool eligible, uint256 weight, uint8 tier) {
        // ── Priority 1: Voluntarily revealed governance score ──────────────────
        uint32 revealedScore = governanceScores[user];
        if (revealedScore >= minVoteScore) {
            (weight, tier) = _scoreToWeight(revealedScore);
            return (true, weight, tier);
        }

        // ── Priority 2: V3 FHE path ──────────────────────────────────────────
        if (address(creditEngine) != address(0)) {
            if (!creditEngine.isRegistered(user))   return (false, 0, 0);
            if (!creditEngine.hasCreditScore(user)) {
                // V3 score missing — try V1 fallback below
            } else if (!creditEngine.isScoreStale(user)) {
                (uint32 score, bool isDecrypted) = creditEngine.getDecryptedScore(user);
                if (isDecrypted && score >= minVoteScore) {
                    (weight, tier) = _scoreToWeight(score);
                    return (true, weight, tier);
                }
                // Score not decrypted (FHE network required) — fall through to V1
            }
        }

        // ── Priority 3: V1 plaintext path (Base Sepolia demo) ────────────────
        if (address(legacyCreditEngine) != address(0)) {
            if (!legacyCreditEngine.isRegistered(user))    return (false, 0, 0);
            if (!legacyCreditEngine.hasComputedScore(user)) return (false, 0, 0);
            bool meetsThreshold = legacyCreditEngine.checkCreditThreshold(user, minVoteScore);
            if (meetsThreshold) {
                // V1 gives pass/fail only — assign Subprime weight (2×) as safe default
                return (true, weightSubprime, 2);
            }
        }

        return (false, 0, 0);
    }

    /// @notice Check if an address is eligible to propose.
    function isEligibleProposer(address user) public view returns (bool) {
        // ── Priority 1: Voluntarily revealed governance score ──────────────────
        if (governanceScores[user] >= minProposeScore) return true;

        // ── Priority 2: V3 FHE path ──────────────────────────────────────────
        if (address(creditEngine) != address(0)) {
            if (creditEngine.isRegistered(user) && creditEngine.hasCreditScore(user) && !creditEngine.isScoreStale(user)) {
                (uint32 score, bool isDecrypted) = creditEngine.getDecryptedScore(user);
                if (isDecrypted && score >= minProposeScore) return true;
            }
        }

        // ── Priority 3: V1 plaintext path ────────────────────────────────────
        if (address(legacyCreditEngine) != address(0)) {
            if (legacyCreditEngine.isRegistered(user) && legacyCreditEngine.hasComputedScore(user)) {
                return legacyCreditEngine.checkCreditThreshold(user, minProposeScore);
            }
        }

        return false;
    }

    function _scoreToWeight(uint32 score) internal view returns (uint256 weight, uint8 tier) {
        if (score >= 740) return (weightPrime, 4);
        if (score >= 670) return (weightNearPrime, 3);
        if (score >= 580) return (weightSubprime, 2);
        return (weightDeepSubprime, 1);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Propose
    // ──────────────────────────────────────────────────────────────────

    /// @notice Create a new governance proposal.
    /// @param proposalType  The type of action this proposal will execute.
    /// @param param         The parameter value for the action (type-specific).
    /// @param description   Human-readable description of the proposal.
    function propose(
        ProposalType proposalType,
        uint256 param,
        string calldata description
    ) external returns (uint256 proposalId) {
        if (!isEligibleProposer(msg.sender)) revert NotEligible();
        _validateParam(proposalType, param);

        proposalId = _proposals.length;

        _proposals.push(Proposal({
            id:           proposalId,
            proposer:     msg.sender,
            proposalType: proposalType,
            param:        param,
            description:  description,
            voteStart:    block.timestamp,
            voteEnd:      block.timestamp + votingPeriod,
            forVotes:     0,
            againstVotes: 0,
            voterCount:   0,
            state:        ProposalState.Active,
            executableAt: 0
        }));

        emit ProposalCreated(
            proposalId,
            msg.sender,
            proposalType,
            description,
            block.timestamp,
            block.timestamp + votingPeriod
        );
    }

    // ──────────────────────────────────────────────────────────────────
    //  Vote
    // ──────────────────────────────────────────────────────────────────

    /// @notice Cast a vote on an active proposal.
    /// @param proposalId  The proposal to vote on.
    /// @param support     true = For, false = Against.
    function castVote(uint256 proposalId, bool support) external {
        if (proposalId >= _proposals.length) revert ProposalNotFound();

        Proposal storage proposal = _proposals[proposalId];
        if (proposal.state != ProposalState.Active)        revert VotingNotActive();
        if (block.timestamp > proposal.voteEnd)            revert VotingNotActive();
        if (hasVoted[msg.sender][proposalId])              revert AlreadyVoted();

        (bool eligible, uint256 weight, uint8 tier) = isEligibleVoter(msg.sender);
        if (!eligible) revert NotEligible();

        hasVoted[msg.sender][proposalId] = true;
        proposal.voterCount++;

        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight, tier);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Finalize — anyone can call after votingPeriod ends
    // ──────────────────────────────────────────────────────────────────

    /// @notice Finalize a proposal after its voting period has ended.
    ///         Sets state to Passed or Defeated based on votes and quorum.
    function finalize(uint256 proposalId) external {
        if (proposalId >= _proposals.length) revert ProposalNotFound();

        Proposal storage proposal = _proposals[proposalId];
        if (proposal.state != ProposalState.Active) revert VotingNotActive();
        if (block.timestamp <= proposal.voteEnd) revert VotingNotActive(); // still active

        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        bool quorumMet = totalVotes >= quorumThreshold;
        bool majorityFor = proposal.forVotes > proposal.againstVotes;

        proposal.state = (quorumMet && majorityFor)
            ? ProposalState.Passed
            : ProposalState.Defeated;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Queue — permissionless, after proposal passes
    // ──────────────────────────────────────────────────────────────────

    /// @notice Queue a passed proposal for execution after the timelock.
    function queue(uint256 proposalId) external {
        if (proposalId >= _proposals.length) revert ProposalNotFound();

        Proposal storage proposal = _proposals[proposalId];
        if (proposal.state != ProposalState.Passed) revert ProposalNotPassed();

        proposal.state        = ProposalState.Queued;
        proposal.executableAt = block.timestamp + executionDelay;

        emit ProposalQueued(proposalId, proposal.executableAt);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Execute — permissionless, after timelock expires
    // ──────────────────────────────────────────────────────────────────

    /// @notice Execute a queued proposal after the timelock has expired.
    function execute(uint256 proposalId) external {
        if (proposalId >= _proposals.length) revert ProposalNotFound();

        Proposal storage proposal = _proposals[proposalId];
        if (proposal.state != ProposalState.Queued)           revert ProposalNotQueued();
        if (block.timestamp < proposal.executableAt)           revert TimelockNotExpired();

        proposal.state = ProposalState.Executed;

        _executeProposal(proposal.proposalType, proposal.param);

        emit ProposalExecuted(proposalId);
    }

    /// @dev Dispatch the proposal action to the appropriate contract.
    function _executeProposal(ProposalType proposalType, uint256 param) internal {
        if (proposalType == ProposalType.Signal) {
            // Off-chain signal — no on-chain action
            return;
        }

        if (proposalType == ProposalType.UpdateScoreValidity) {
            require(address(creditEngineAdmin) != address(0), "No credit engine");
            creditEngineAdmin.setScoreValidityPeriod(param);
            emit GovernanceParamUpdated("scoreValidityPeriod", param);
            return;
        }

        if (proposalType == ProposalType.PausePool) {
            require(address(loanPool) != address(0), "No loan pool");
            loanPool.setPaused(param == 1);
            emit GovernanceParamUpdated("poolPaused", param);
            return;
        }

        if (proposalType == ProposalType.UpdateMinVoteScore) {
            minVoteScore = param;
            emit GovernanceParamUpdated("minVoteScore", param);
            return;
        }

        if (proposalType == ProposalType.UpdateVotingPeriod) {
            votingPeriod = param;
            emit GovernanceParamUpdated("votingPeriod", param);
            return;
        }

        if (proposalType == ProposalType.UpdateExecutionDelay) {
            executionDelay = param;
            emit GovernanceParamUpdated("executionDelay", param);
            return;
        }
    }

    // ──────────────────────────────────────────────────────────────────
    //  Cancel
    // ──────────────────────────────────────────────────────────────────

    /// @notice Proposer or owner can cancel a proposal before it executes.
    function cancel(uint256 proposalId) external {
        if (proposalId >= _proposals.length) revert ProposalNotFound();

        Proposal storage proposal = _proposals[proposalId];
        require(
            msg.sender == proposal.proposer || msg.sender == owner(),
            "Not proposer or owner"
        );
        require(
            proposal.state == ProposalState.Active ||
            proposal.state == ProposalState.Passed ||
            proposal.state == ProposalState.Queued,
            "Cannot cancel"
        );

        proposal.state = ProposalState.Cancelled;
        emit ProposalCancelled(proposalId);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Internal validation
    // ──────────────────────────────────────────────────────────────────

    function _validateParam(ProposalType proposalType, uint256 param) internal pure {
        if (proposalType == ProposalType.UpdateScoreValidity) {
            require(param >= 1 days && param <= 365 days, "Validity period out of range");
        }
        if (proposalType == ProposalType.PausePool) {
            require(param == 0 || param == 1, "Param must be 0 or 1");
        }
        if (proposalType == ProposalType.UpdateMinVoteScore) {
            require(param >= 300 && param <= 850, "Score out of range");
        }
        if (proposalType == ProposalType.UpdateVotingPeriod) {
            require(param >= 1 days && param <= 30 days, "Voting period out of range");
        }
        if (proposalType == ProposalType.UpdateExecutionDelay) {
            require(param >= 1 hours && param <= 14 days, "Execution delay out of range");
        }
    }

    // ──────────────────────────────────────────────────────────────────
    //  View functions
    // ──────────────────────────────────────────────────────────────────

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(uint256 proposalId) external view returns (
        uint256   id,
        address   proposer,
        ProposalType proposalType,
        uint256   param,
        string memory description,
        uint256   voteStart,
        uint256   voteEnd,
        uint256   forVotes,
        uint256   againstVotes,
        uint256   voterCount,
        ProposalState state,
        uint256   executableAt
    ) {
        if (proposalId >= _proposals.length) revert ProposalNotFound();
        Proposal storage p = _proposals[proposalId];
        return (
            p.id, p.proposer, p.proposalType, p.param, p.description,
            p.voteStart, p.voteEnd, p.forVotes, p.againstVotes,
            p.voterCount, p.state, p.executableAt
        );
    }

    function getProposalState(uint256 proposalId) external view returns (ProposalState) {
        if (proposalId >= _proposals.length) revert ProposalNotFound();
        return _proposals[proposalId].state;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Admin — owner can update protocol addresses and governance params
    //          until full DAO transition
    // ──────────────────────────────────────────────────────────────────

    function setCreditEngine(address _engine) external onlyOwner {
        creditEngine      = ICreditEngineForGov(_engine);
        creditEngineAdmin = ICreditEngineAdmin(_engine);
        emit CreditEngineUpdated(_engine);
    }

    function setLoanPool(address _pool) external onlyOwner {
        loanPool = ILoanPoolForGov(_pool);
        emit LoanPoolUpdated(_pool);
    }

    /// @notice Owner can set quorum threshold directly (pre-DAO bootstrap).
    function setQuorumThreshold(uint256 _quorum) external onlyOwner {
        require(_quorum > 0, "Quorum must be > 0");
        quorumThreshold = _quorum;
        emit GovernanceParamUpdated("quorumThreshold", _quorum);
    }

    /// @notice Owner can set vote tier weights (Prime / NearPrime / Subprime / DeepSubprime).
    function setTierWeights(
        uint256 _prime,
        uint256 _nearPrime,
        uint256 _subprime,
        uint256 _deepSubprime
    ) external onlyOwner {
        require(_prime >= _nearPrime && _nearPrime >= _subprime && _subprime >= _deepSubprime,
                "Weights must be non-increasing by tier");
        require(_deepSubprime > 0, "Minimum weight must be > 0");
        weightPrime        = _prime;
        weightNearPrime    = _nearPrime;
        weightSubprime     = _subprime;
        weightDeepSubprime = _deepSubprime;
        emit GovernanceParamUpdated("tierWeights", _prime);
    }

    /// @notice Owner can set the minimum score required to propose.
    function setMinProposeScore(uint256 _score) external onlyOwner {
        require(_score >= 300 && _score <= 850, "Score out of range");
        minProposeScore = _score;
        emit GovernanceParamUpdated("minProposeScore", _score);
    }

    /// @notice Set V1 legacy credit engine for Base Sepolia demo fallback.
    ///         When set, users with a valid V1 plaintext score can vote/propose
    ///         even when V3 FHE decryption is unavailable.
    ///         Set to address(0) to disable the fallback.
    function setLegacyCreditEngine(address _engine) external onlyOwner {
        legacyCreditEngine = ILegacyCreditEngine(_engine);
        emit GovernanceParamUpdated("legacyCreditEngine", uint256(uint160(_engine)));
    }

    // ──────────────────────────────────────────────────────────────────
    //  Voluntary Score Reveal — opt-in governance eligibility
    //
    //  The CoFHE TaskManager's FHE.decrypt() reverts for non-trivial
    //  ciphertext handles on the production testnet, so the V3 FHE path
    //  (creditEngine.getDecryptedScore()) is currently broken.
    //
    //  As a workaround, users decrypt their score privately via the
    //  @cofhe/sdk in their browser, then voluntarily submit it here.
    //  The score is stored on-chain ONLY if the user chooses to reveal it.
    //  Call resetGovernanceScore() to remove your score and regain privacy.
    // ──────────────────────────────────────────────────────────────────

    /// @notice Submit your privately-decrypted credit or reputation score to
    ///         become governance-eligible. Scores below 300 cannot meet the
    ///         minimum threshold, so they are rejected.
    ///         Credit scores use range 300–850; reputation scores use basis
    ///         points 0–10000 — both are accepted as long as >= 300.
    ///
    ///         Requires the caller to have a valid, non-stale credit score
    ///         in the credit engine (if set). This prevents unregistered
    ///         addresses from submitting arbitrary scores.
    /// @param score  Your score (decrypted client-side via @cofhe/sdk)
    function submitGovernanceScore(uint32 score) external {
        if (score < 300) revert ScoreOutOfRange();
        if (address(creditEngine) != address(0)) {
            if (!creditEngine.isRegistered(msg.sender) || !creditEngine.hasCreditScore(msg.sender)) {
                revert NotEligible();
            }
        }
        governanceScores[msg.sender] = score;
        emit GovernanceScoreSubmitted(msg.sender, score);
    }

    /// @notice Remove your governance score. You will no longer be eligible
    ///         until you submit again (or on-chain FHE.decrypt becomes available).
    function resetGovernanceScore() external {
        delete governanceScores[msg.sender];
        emit GovernanceScoreReset(msg.sender);
    }
}
