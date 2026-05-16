// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Minimal interface to EncryptedCreditEngineV3
interface ICreditEngineV3 {
    function isRegistered(address user) external view returns (bool);
    function hasCreditScore(address user) external view returns (bool);
    function isScoreStale(address user) external view returns (bool);
    function scoreComputedAt(address user) external view returns (uint256);
    function getScoreHistoryLength(address user) external view returns (uint256);
    function getDecryptedScore(address user) external view returns (uint32 score, bool isDecrypted);
}

/// @title SoulboundCreditNFT
/// @notice Wave 4 — ERC-721 soulbound credit identity NFT.
///
/// Each wallet address can hold exactly ONE token.
/// The token is non-transferable: transfer() and approve() revert.
/// The token's metadata reflects the holder's on-chain credit tier
/// (derived from their decrypted credit score) and score history length.
///
/// Privacy design:
///   - The NFT does NOT store the raw credit score on-chain.
///   - The displayed "tier" (Prime / NearPrime / Subprime / DeepSubprime / Unrated)
///     is derived from the decrypted score stored by EncryptedCreditEngineV3.
///     If the score has not been publicly decrypted, the tier shows as "Unrated".
///   - The score history length (count of score computations) IS public — it
///     proves trajectory without revealing values.
///
/// Mint conditions:
///   - Caller must be registered in EncryptedCreditEngineV3.
///   - Caller must have computed at least one credit score.
///   - One mint per address — no re-minting after burn.
///
/// Burn:
///   - The holder can burn their own token at any time.
///   - After burning, the holder can re-mint if they still meet conditions.
///
/// Metadata:
///   - On-chain SVG generated from credit tier, history length, and score age.
///   - No IPFS dependency.
contract SoulboundCreditNFT is ERC721, Ownable {
    using Strings for uint256;

    // ──────────────────────────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────────────────────────

    event CreditIdentityMinted(address indexed holder, uint256 indexed tokenId, CreditTier tier);
    event CreditIdentityBurned(address indexed holder, uint256 indexed tokenId);
    event TierRefreshed(address indexed holder, uint256 indexed tokenId, CreditTier oldTier, CreditTier newTier);
    event CreditEngineUpdated(address indexed engine);

    // ──────────────────────────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────────────────────────

    error AlreadyMinted();
    error NotRegistered();
    error NoScoreComputed();
    error Soulbound();          // transfer/approve attempts
    error NotHolder();
    error NoCreditEngine();
    error TokenNotFound();

    // ──────────────────────────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────────────────────────

    enum CreditTier {
        Unrated,       // 0 — score not publicly decrypted yet
        DeepSubprime,  // 1 — 300–579
        Subprime,      // 2 — 580–669
        NearPrime,     // 3 — 670–739
        Prime          // 4 — 740–850
    }

    // ──────────────────────────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────────────────────────

    ICreditEngineV3 public creditEngine;

    uint256 private _nextTokenId;

    /// @notice One token ID per address (0 means not minted)
    mapping(address => uint256) public holderToken;

    /// @notice Token metadata snapshot (updated on refreshTier)
    mapping(uint256 => TokenData) private _tokenData;

    struct TokenData {
        address   holder;
        CreditTier tier;
        uint256   scoreHistoryLength; // count of score computations
        uint256   mintedAt;
        uint256   lastRefreshedAt;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────────────────────────

    constructor(address _owner, address _creditEngine)
        ERC721("Shadow Credit Identity", "SCID")
        Ownable(_owner)
    {
        if (_creditEngine != address(0)) {
            creditEngine = ICreditEngineV3(_creditEngine);
        }
        _nextTokenId = 1; // Start at token ID 1
    }

    // ──────────────────────────────────────────────────────────────────
    //  Mint — one per wallet, soulbound
    // ──────────────────────────────────────────────────────────────────

    /// @notice Mint your soulbound credit identity NFT.
    /// @dev Requires registration + at least one score computation in the credit engine.
    function mint() external {
        if (address(creditEngine) == address(0)) revert NoCreditEngine();
        if (holderToken[msg.sender] != 0) revert AlreadyMinted();
        if (!creditEngine.isRegistered(msg.sender)) revert NotRegistered();
        if (!creditEngine.hasCreditScore(msg.sender)) revert NoScoreComputed();

        uint256 tokenId = _nextTokenId++;

        CreditTier tier = _resolveTier(msg.sender);
        uint256 histLen = creditEngine.getScoreHistoryLength(msg.sender);

        _tokenData[tokenId] = TokenData({
            holder:             msg.sender,
            tier:               tier,
            scoreHistoryLength: histLen,
            mintedAt:           block.timestamp,
            lastRefreshedAt:    block.timestamp
        });

        holderToken[msg.sender] = tokenId;

        _safeMint(msg.sender, tokenId);

        emit CreditIdentityMinted(msg.sender, tokenId, tier);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Tier Refresh — update metadata from current chain state
    // ──────────────────────────────────────────────────────────────────

    /// @notice Refresh the on-chain tier and history length from the credit engine.
    /// @dev Anyone can call this — the data is derived from public chain state.
    ///      Useful after a new score computation or public decryption.
    function refreshTier(address holder) external {
        uint256 tokenId = holderToken[holder];
        if (tokenId == 0) revert TokenNotFound();

        TokenData storage data = _tokenData[tokenId];
        CreditTier oldTier = data.tier;

        data.tier               = _resolveTier(holder);
        data.scoreHistoryLength = creditEngine.getScoreHistoryLength(holder);
        data.lastRefreshedAt    = block.timestamp;

        emit TierRefreshed(holder, tokenId, oldTier, data.tier);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Burn
    // ──────────────────────────────────────────────────────────────────

    /// @notice Burn your own credit identity NFT.
    function burn() external {
        uint256 tokenId = holderToken[msg.sender];
        if (tokenId == 0 || _ownerOf(tokenId) != msg.sender) revert NotHolder();

        delete holderToken[msg.sender];
        delete _tokenData[tokenId];

        _burn(tokenId);

        emit CreditIdentityBurned(msg.sender, tokenId);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Soulbound — block all transfers and approvals
    // ──────────────────────────────────────────────────────────────────

    /// @dev Override ERC-721 transfer hook — revert all transfers except mint/burn.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);

        // Allow: mint (from == address(0)) and burn (to == address(0))
        if (from != address(0) && to != address(0)) {
            revert Soulbound();
        }

        return super._update(to, tokenId, auth);
    }

    /// @dev Block all approval operations — soulbound tokens cannot be approved.
    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    /// @dev Block setApprovalForAll — soulbound tokens cannot be approved.
    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    // ──────────────────────────────────────────────────────────────────
    //  On-chain SVG Metadata
    // ──────────────────────────────────────────────────────────────────

    /// @notice ERC-721 tokenURI — returns a data URI containing an on-chain SVG.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenNotFound();

        TokenData storage data = _tokenData[tokenId];

        string memory tierName   = _tierName(data.tier);
        string memory tierColor  = _tierColor(data.tier);
        string memory tierBadge  = _tierBadge(data.tier);
        string memory histStr    = data.scoreHistoryLength.toString();
        string memory ageStr     = _scoreAgeStr(data.holder);

        // Build SVG
        string memory svg = string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 520" width="400" height="520">',
            '<defs>',
              '<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
                '<stop offset="0%" style="stop-color:#0a0a1a;stop-opacity:1" />',
                '<stop offset="100%" style="stop-color:#0d1b2a;stop-opacity:1" />',
              '</linearGradient>',
              '<linearGradient id="tier" x1="0%" y1="0%" x2="100%" y2="0%">',
                '<stop offset="0%" style="stop-color:', tierColor, ';stop-opacity:0.8" />',
                '<stop offset="100%" style="stop-color:', tierColor, ';stop-opacity:0.3" />',
              '</linearGradient>',
              '<filter id="glow">',
                '<feGaussianBlur stdDeviation="3" result="coloredBlur"/>',
                '<feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>',
              '</filter>',
            '</defs>',
            // Background
            '<rect width="400" height="520" rx="20" fill="url(#bg)" />',
            // Tier accent bar
            '<rect x="0" y="0" width="400" height="6" rx="3" fill="', tierColor, '" />',
            // Protocol name
            '<text x="200" y="50" font-family="monospace" font-size="13" fill="#4a9eff" '
              'text-anchor="middle" letter-spacing="4">SHADOW CREDIT NETWORK</text>',
            // NFT label
            '<text x="200" y="78" font-family="monospace" font-size="10" fill="#ffffff44" '
              'text-anchor="middle" letter-spacing="2">CREDIT IDENTITY</text>',
            // Tier badge circle
            '<circle cx="200" cy="185" r="80" fill="none" stroke="', tierColor, '" stroke-width="2" opacity="0.3" filter="url(#glow)" />',
            '<circle cx="200" cy="185" r="65" fill="none" stroke="', tierColor, '" stroke-width="1" opacity="0.6" />',
            '<text x="200" y="170" font-family="serif" font-size="40" fill="', tierColor, '" '
              'text-anchor="middle" filter="url(#glow)">', tierBadge, '</text>',
            // Tier name
            '<text x="200" y="215" font-family="monospace" font-size="16" fill="', tierColor, '" '
              'text-anchor="middle" font-weight="bold" letter-spacing="1">', tierName, '</text>',
            // Divider
            '<line x1="40" y1="295" x2="360" y2="295" stroke="#ffffff22" stroke-width="1" />',
            // Stats
            _buildStatRow("SCORE COMPUTATIONS", histStr, "340"),
            _buildStatRow("SCORE AGE", ageStr, "385"),
            _buildStatRow("PROTOCOL", "Shadow Credit v3", "430"),
            // Soulbound badge
            '<rect x="120" y="465" width="160" height="30" rx="15" fill="', tierColor, '" opacity="0.15" stroke="', tierColor, '" stroke-width="1" opacity="0.4" />',
            '<text x="200" y="485" font-family="monospace" font-size="11" fill="', tierColor, '" '
              'text-anchor="middle" letter-spacing="2">&#9670; SOULBOUND &#9670;</text>',
            '</svg>'
        ));

        // Build JSON metadata
        string memory json = Base64.encode(bytes(string(abi.encodePacked(
            '{"name":"Shadow Credit Identity #', tokenId.toString(), '",',
            '"description":"A soulbound on-chain credit identity issued by Shadow Credit Network. Non-transferable. Tier reflects encrypted FHE credit score.",',
            '"attributes":[',
              '{"trait_type":"Tier","value":"', tierName, '"},',
              '{"trait_type":"Score Computations","value":', histStr, '},',
              '{"trait_type":"Score Age","value":"', ageStr, '"},',
              '{"trait_type":"Soulbound","value":true}',
            '],',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '"}'
        ))));

        return string(abi.encodePacked("data:application/json;base64,", json));
    }

    // ──────────────────────────────────────────────────────────────────
    //  Internal helpers
    // ──────────────────────────────────────────────────────────────────

    /// @dev Resolve the credit tier from the publicly decrypted score.
    ///      Returns Unrated if the score has not been publicly decrypted.
    function _resolveTier(address holder) internal view returns (CreditTier) {
        if (address(creditEngine) == address(0)) return CreditTier.Unrated;
        if (!creditEngine.hasCreditScore(holder)) return CreditTier.Unrated;

        try creditEngine.getDecryptedScore(holder) returns (uint32 score, bool isDecrypted) {
            if (!isDecrypted || score == 0) return CreditTier.Unrated;
            if (score >= 740) return CreditTier.Prime;
            if (score >= 670) return CreditTier.NearPrime;
            if (score >= 580) return CreditTier.Subprime;
            return CreditTier.DeepSubprime;
        } catch {
            return CreditTier.Unrated;
        }
    }

    function _tierName(CreditTier tier) internal pure returns (string memory) {
        if (tier == CreditTier.Prime)        return "PRIME";
        if (tier == CreditTier.NearPrime)    return "NEAR PRIME";
        if (tier == CreditTier.Subprime)     return "SUBPRIME";
        if (tier == CreditTier.DeepSubprime) return "DEEP SUBPRIME";
        return "UNRATED";
    }

    function _tierColor(CreditTier tier) internal pure returns (string memory) {
        if (tier == CreditTier.Prime)        return "#00d4aa";   // teal
        if (tier == CreditTier.NearPrime)    return "#4a9eff";   // blue
        if (tier == CreditTier.Subprime)     return "#f59e0b";   // amber
        if (tier == CreditTier.DeepSubprime) return "#ef4444";   // red
        return "#6b7280";                                         // grey
    }

    function _tierBadge(CreditTier tier) internal pure returns (string memory) {
        if (tier == CreditTier.Prime)        return unicode"✦";
        if (tier == CreditTier.NearPrime)    return unicode"◆";
        if (tier == CreditTier.Subprime)     return unicode"◇";
        if (tier == CreditTier.DeepSubprime) return unicode"○";
        return unicode"?";
    }

    function _scoreAgeStr(address holder) internal view returns (string memory) {
        if (address(creditEngine) == address(0)) return "N/A";
        if (!creditEngine.hasCreditScore(holder)) return "N/A";
        if (creditEngine.isScoreStale(holder)) return "STALE";

        uint256 computedAt = creditEngine.scoreComputedAt(holder);
        if (computedAt == 0) return "N/A";

        uint256 ageDays = (block.timestamp - computedAt) / 1 days;
        return string(abi.encodePacked(ageDays.toString(), " days"));
    }

    function _buildStatRow(
        string memory label,
        string memory value,
        string memory yPos
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '<text x="40" y="', yPos, '" font-family="monospace" font-size="10" fill="#ffffff55">', label, '</text>',
            '<text x="360" y="', yPos, '" font-family="monospace" font-size="11" fill="#ffffff99" text-anchor="end">', value, '</text>'
        ));
    }

    // ──────────────────────────────────────────────────────────────────
    //  View functions
    // ──────────────────────────────────────────────────────────────────

    /// @notice Get the token data for a holder.
    function getTokenData(address holder) external view returns (
        uint256 tokenId,
        CreditTier tier,
        uint256 scoreHistoryLength,
        uint256 mintedAt,
        uint256 lastRefreshedAt
    ) {
        tokenId = holderToken[holder];
        if (tokenId == 0) revert TokenNotFound();
        TokenData storage data = _tokenData[tokenId];
        return (tokenId, data.tier, data.scoreHistoryLength, data.mintedAt, data.lastRefreshedAt);
    }

    /// @notice Check whether an address has a valid (non-burned) credit identity.
    function hasIdentity(address holder) external view returns (bool) {
        return holderToken[holder] != 0;
    }

    /// @notice Total tokens minted (includes burned).
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────────────────────────

    /// @notice Update the credit engine address (e.g., on V4 upgrade).
    function setCreditEngine(address _engine) external onlyOwner {
        creditEngine = ICreditEngineV3(_engine);
        emit CreditEngineUpdated(_engine);
    }
}
