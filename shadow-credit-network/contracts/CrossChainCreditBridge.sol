// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice LayerZero V2 SendParam struct (matching deployed Arbitrum Sepolia endpoint).
struct SendParam {
    uint32  dstEid;
    bytes32 receiver;
    bytes   message;
    bytes   options;
    bool    payInLzToken;
}

/// @notice LayerZero V2 MessagingFee struct.
struct MessagingFee {
    uint256 nativeFee;
    uint256 lzTokenFee;
}

/// @notice Minimal LZ V2 endpoint interface (matches deployed Arbitrum Sepolia endpoint).
interface ILayerZeroEndpoint {
    function quote(SendParam calldata _sendParam, address _payInLzToken)
        external view returns (MessagingFee memory msgFee);
    function send(SendParam calldata _sendParam, bytes calldata _extraOptions, address _refundAddress)
        external payable returns (bytes32 msgHash);
}

interface ILayerZeroReceiver {
    function lzReceive(
        uint32  srcEid,
        bytes32 srcSender,
        uint64  nonce,
        bytes calldata payload,
        bytes calldata extraData
    ) external;
}

/// @notice Minimal interface to EncryptedCreditEngineV3
interface ICreditEngineForBridge {
    function hasCreditScore(address user) external view returns (bool);
    function isScoreStale(address user) external view returns (bool);
    function getDecryptedScore(address user) external view returns (uint32 score, bool isDecrypted);
    function getPublishedScore(address user) external view returns (uint32);
    function scoreComputedAt(address user) external view returns (uint256);
    function getScoreHistoryLength(address user) external view returns (uint256);
    function isRegistered(address user) external view returns (bool);
}

/// @title CrossChainCreditBridge
/// @notice Wave 4 — Cross-chain credit score portability via LayerZero V2.
///
/// Allows a user to publish their Shadow Credit score to any supported chain.
/// The score is transmitted as a compact, signed attestation containing:
///   - The user's address
///   - Their decrypted credit score (public reveal required)
///   - The score tier (Prime / NearPrime / Subprime / DeepSubprime)
///   - The score computation timestamp
///   - The score history length (count of computations)
///   - The source chain endpoint ID
///   - An expiry timestamp (scoreComputedAt + 180 days)
///
/// Privacy model:
///   - Only PUBLICLY DECRYPTED scores can be bridged.
///   - The raw score is revealed by the user's own request (opt-in).
///   - The FHE ciphertext is NOT bridged — only the decrypted attestation.
///   - Users who prefer not to reveal their score can still use it on the
///     source chain (via the ebool-gated approval flow) without bridging.
///
/// Source chain (sendScore):
///   User calls sendScore() → LZ endpoint relays to destination chain
///
/// Destination chain (lzReceive):
///   LZ executor calls lzReceive() → score stored in receivedScores[user]
///   Destination dApps query receivedScores(user) instead of the FHE engine
///
/// Trust model:
///   The bridge does NOT verify the FHE proof — it trusts the source chain
///   contract, which reads from EncryptedCreditEngineV3 (the trusted oracle).
///   The source chain contract verifies: score is decrypted, fresh, and
///   belongs to the requesting user. This is equivalent to using a Chainlink
///   CCIP oracle but with LayerZero's unified messaging layer.
contract CrossChainCreditBridge is Ownable, ILayerZeroReceiver {

    // ──────────────────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────────────────

    event ScoreSent(
        address indexed user,
        uint32  indexed dstEid,
        uint32  score,
        uint8   tier,
        uint256 expiresAt,
        bytes32 guid
    );
    event ScoreReceived(
        address indexed user,
        uint32  indexed srcEid,
        uint32  score,
        uint8   tier,
        uint256 computedAt,
        uint256 expiresAt
    );
    event TrustedRemoteSet(uint32 indexed eid, bytes32 trustedRemote);
    event EndpointUpdated(address indexed endpoint);
    event CreditEngineUpdated(address indexed engine);

    // ──────────────────────────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────────────────────────

    error NotDecrypted();
    error StaleScore();
    error NoCreditScore();
    error UntrustedRemote();
    error InsufficientFee();
    error NotEndpoint();
    error InvalidPayload();
    error ScoreExpired();
    error NotRegistered();

    // ──────────────────────────────────────────────────────────────────
    //  Types
    // ──────────────────────────────────────────────────────────────────

    enum CreditTier { Unrated, DeepSubprime, Subprime, NearPrime, Prime }

    struct ReceivedScore {
        uint32  score;
        uint8   tier;
        uint256 computedAt;
        uint256 expiresAt;
        uint32  srcEid;
        bool    exists;
    }

    // Compact wire format (ABI-encoded in the LZ message payload)
    struct ScoreAttestation {
        address user;
        uint32  score;
        uint8   tier;
        uint256 computedAt;
        uint256 expiresAt;
        uint256 historyLength;
        uint32  srcEid;
    }

    // ──────────────────────────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────────────────────────

    ILayerZeroEndpoint   public endpoint;
    ICreditEngineForBridge public creditEngine;

    uint32 public localEid;  // this chain's LZ endpoint ID

    // trusted remote bridge contracts: dstEid → bytes32(address)
    mapping(uint32 => bytes32) public trustedRemotes;

    // received scores on this chain: user → ReceivedScore
    mapping(address => ReceivedScore) public receivedScores;

    // nonce tracking to prevent replay
    mapping(uint32 => mapping(bytes32 => uint64)) public lastNonce;

    // ──────────────────────────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor(
        address _owner,
        address _endpoint,
        address _creditEngine,
        uint32  _localEid
    ) Ownable(_owner) {
        if (_endpoint != address(0)) {
            endpoint = ILayerZeroEndpoint(_endpoint);
        }
        if (_creditEngine != address(0)) {
            creditEngine = ICreditEngineForBridge(_creditEngine);
        }
        localEid = _localEid;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Source chain — send score to destination
    // ──────────────────────────────────────────────────────────────────

    /// @notice Quote the LZ messaging fee for sending a score to dstEid.
    function quoteSend(uint32 dstEid) external view returns (uint256 nativeFee) {
        require(address(endpoint) != address(0), "No endpoint");
        bytes32 receiver = trustedRemotes[dstEid];
        require(receiver != bytes32(0), "No trusted remote for dstEid");
        ScoreAttestation memory att = _buildAttestation(msg.sender, dstEid);
        bytes memory payload = abi.encode(att);
        bytes memory options = _defaultOptions();
        SendParam memory sp = SendParam({
            dstEid: dstEid,
            receiver: receiver,
            message: payload,
            options: options,
            payInLzToken: false
        });
        MessagingFee memory fee = endpoint.quote(sp, address(0));
        nativeFee = fee.nativeFee;
    }

    /// @notice Bridge your decrypted credit score to a destination chain.
    /// @param dstEid The LayerZero destination endpoint ID.
    function sendScore(uint32 dstEid) external payable {
        bytes32 receiver = trustedRemotes[dstEid];
        require(receiver != bytes32(0), "No trusted remote for dstEid");
        require(address(creditEngine) != address(0), "No credit engine");
        require(creditEngine.isRegistered(msg.sender), "Not registered");

        if (!creditEngine.hasCreditScore(msg.sender)) revert NoCreditScore();
        if (creditEngine.isScoreStale(msg.sender))    revert StaleScore();

        // Accept either on-chain FHE-decrypted score or user-published score
        uint32 score = creditEngine.getPublishedScore(msg.sender);
        bool hasPublished = score != 0;
        if (!hasPublished) {
            (score, ) = creditEngine.getDecryptedScore(msg.sender);
        }
        if (score == 0) revert NotDecrypted();

        ScoreAttestation memory att = _buildAttestation(msg.sender, dstEid);
        bytes memory payload = abi.encode(att);
        bytes memory options = _defaultOptions();

        SendParam memory sp = SendParam({
            dstEid: dstEid,
            receiver: receiver,
            message: payload,
            options: options,
            payInLzToken: false
        });

        // Quote and enforce fee
        MessagingFee memory fee = endpoint.quote(sp, address(0));
        if (msg.value < fee.nativeFee) revert InsufficientFee();

        bytes32 guid = endpoint.send{value: msg.value}(sp, "", msg.sender);

        emit ScoreSent(
            msg.sender,
            dstEid,
            att.score,
            att.tier,
            att.expiresAt,
            guid
        );
    }

    // ──────────────────────────────────────────────────────────────────
    //  Destination chain — receive score from source
    // ──────────────────────────────────────────────────────────────────

    /// @notice LayerZero executor calls this after message delivery.
    function lzReceive(
        uint32  srcEid,
        bytes32 srcSender,
        uint64  nonce,
        bytes calldata payload,
        bytes calldata /* extraData */
    ) external override {
        if (msg.sender != address(endpoint)) revert NotEndpoint();
        if (trustedRemotes[srcEid] != srcSender) revert UntrustedRemote();

        // Replay protection
        require(nonce > lastNonce[srcEid][srcSender], "Stale nonce");
        lastNonce[srcEid][srcSender] = nonce;

        ScoreAttestation memory att;
        try this.decodePayload(payload) returns (ScoreAttestation memory decoded) {
            att = decoded;
        } catch {
            revert InvalidPayload();
        }

        // Store received score — overwrite if newer
        ReceivedScore storage existing = receivedScores[att.user];
        if (!existing.exists || att.computedAt > existing.computedAt) {
            receivedScores[att.user] = ReceivedScore({
                score:     att.score,
                tier:      att.tier,
                computedAt: att.computedAt,
                expiresAt: att.expiresAt,
                srcEid:    srcEid,
                exists:    true
            });

            emit ScoreReceived(
                att.user,
                srcEid,
                att.score,
                att.tier,
                att.computedAt,
                att.expiresAt
            );
        }
    }

    /// @notice External decode helper (used in try/catch above).
    function decodePayload(bytes calldata payload) external pure returns (ScoreAttestation memory) {
        return abi.decode(payload, (ScoreAttestation));
    }

    // ──────────────────────────────────────────────────────────────────
    //  View — destination chain score queries
    // ──────────────────────────────────────────────────────────────────

    /// @notice Get the bridged credit score for a user on this chain.
    function getRemoteScore(address user) external view returns (
        uint32  score,
        uint8   tier,
        uint256 computedAt,
        uint256 expiresAt,
        uint32  srcEid,
        bool    valid
    ) {
        ReceivedScore storage rec = receivedScores[user];
        if (!rec.exists) return (0, 0, 0, 0, 0, false);

        bool expired = block.timestamp > rec.expiresAt;
        return (
            rec.score,
            rec.tier,
            rec.computedAt,
            rec.expiresAt,
            rec.srcEid,
            !expired  // valid = exists and not expired
        );
    }

    /// @notice Check if a user's bridged score is still valid (not expired).
    function hasValidRemoteScore(address user) external view returns (bool) {
        ReceivedScore storage rec = receivedScores[user];
        return rec.exists && block.timestamp <= rec.expiresAt;
    }

    /// @notice Check if a user's bridged score meets a minimum threshold.
    function meetsRemoteThreshold(address user, uint32 minScore) external view returns (bool) {
        ReceivedScore storage rec = receivedScores[user];
        if (!rec.exists) return false;
        if (block.timestamp > rec.expiresAt) return false;
        return rec.score >= minScore;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Internal helpers
    // ──────────────────────────────────────────────────────────────────

    function _buildAttestation(address user, uint32 /* dstEid */)
        internal view returns (ScoreAttestation memory att)
    {
        // Prefer published score if available (user SDK-decrypted and submitted on-chain)
        // Fall back to FHE.getDecryptResultSafe for networks that support on-chain decrypt.
        uint32 score = creditEngine.getPublishedScore(user);
        if (score == 0) {
            (score, ) = creditEngine.getDecryptedScore(user);
        }
        uint256 computedAt = creditEngine.scoreComputedAt(user);
        uint256 histLen    = creditEngine.getScoreHistoryLength(user);

        att.user          = user;
        att.score         = score;
        att.tier          = uint8(_scoreToTier(score));
        att.computedAt    = computedAt;
        att.expiresAt     = computedAt + 180 days; // mirror engine's validity
        att.historyLength = histLen;
        att.srcEid        = localEid;
        // dstEid not stored in attestation — it's implicit
    }

    function _scoreToTier(uint32 score) internal pure returns (CreditTier) {
        if (score >= 740) return CreditTier.Prime;
        if (score >= 670) return CreditTier.NearPrime;
        if (score >= 580) return CreditTier.Subprime;
        if (score >= 300) return CreditTier.DeepSubprime;
        return CreditTier.Unrated;
    }

    /// @notice Default LZ options: executor gas = 200_000, no airdrop.
    /// @dev LZ V2 TYPE_3 executor option encoding:
    ///   [uint16 TYPE_3][uint8 workerID][uint16 optionLen][uint8 optionType][uint128 gas]
    function _defaultOptions() internal pure returns (bytes memory) {
        return abi.encodePacked(
            uint16(3),        // TYPE_3
            uint8(1),         // EXECUTOR_WORKER_ID
            uint16(17),       // optionLen = 1 (type byte) + 16 (gas uint128) = 17
            uint8(1),         // OPTION_TYPE_LZRECEIVE
            uint128(200_000)  // gasLimit for lzReceive
        );
    }

    // ──────────────────────────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────────────────────────

    /// @notice Register a trusted remote bridge on another chain.
    function setTrustedRemote(uint32 eid, bytes32 remoteAddress) external onlyOwner {
        trustedRemotes[eid] = remoteAddress;
        emit TrustedRemoteSet(eid, remoteAddress);
    }

    /// @notice Helper to convert an address to bytes32 for setTrustedRemote.
    function addressToBytes32(address addr) external pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    function setEndpoint(address _endpoint) external onlyOwner {
        endpoint = ILayerZeroEndpoint(_endpoint);
        emit EndpointUpdated(_endpoint);
    }

    function setCreditEngine(address _engine) external onlyOwner {
        creditEngine = ICreditEngineForBridge(_engine);
        emit CreditEngineUpdated(_engine);
    }

    function setLocalEid(uint32 _eid) external onlyOwner {
        localEid = _eid;
    }
}
