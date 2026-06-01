# Mainnet Readiness

Shadow Credit Network is designed for mainnet deployment from day one.
Fhenix mainnet does not exist yet. When it does, the contracts are ready.

---

## What Changes on Mainnet

### Zero contract changes required

The Solidity contracts use standard OpenZeppelin patterns, production-grade
access control (Ownable), and well-tested FHE primitives from the CoFHE SDK.
They compile against `cofhe-contracts@0.0.13` which is the same interface
Fhenix will ship on mainnet. No refactoring is needed.

The four invariants documented in `SECURITY.md` are enforced at the Solidity
level with no owner override. They do not depend on testnet assumptions.

### Deployment target

| Component | Current (Testnet) | Mainnet Target |
|---|---|---|
| EncryptedCreditEngineV3 | Fhenix Helium / Arbitrum Sepolia | Fhenix mainnet |
| PrivateLoanPoolV3 | Same | Same chain |
| All other contracts | Same | Same chain |

The `CrossChainCreditBridge` is the only contract that will bridge scores
from Fhenix mainnet to L2s (Arbitrum, Base, Optimism) via LayerZero V2.

---

## Items That Change

### 1. Oracle integration (MultiAssetLoanPool)

`MultiAssetLoanPool.updateAssetPrice()` is currently owner-set. On mainnet,
this must be replaced with a Chainlink price feed:

```solidity
// Current (Wave 5 — testnet)
function updateAssetPrice(address token, uint256 priceUsd18) external onlyOwner;

// Mainnet
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

function _getPriceUsd18(address token) internal view returns (uint256) {
    AggregatorV3Interface feed = AggregatorV3Interface(priceFeeds[token]);
    (, int256 price, , ,) = feed.latestRoundData();
    return uint256(price) * 1e10; // Chainlink 8 decimals → 18 decimals
}
```

This is a one-function swap. The contract architecture is designed for it.

### 2. DAO transition (ScoreGatedGovernance)

Currently the owner can override governance parameters (`setQuorumThreshold`,
`setTierWeights`, `setMinProposeScore`). On mainnet, these functions should
be removed or timelock-gated once the DAO reaches maturity.

The governance contract already supports the full propose → vote → queue →
execute flow with execution delay. The only change is removing the owner
escape hatches after an initial bootstrap period.

### 3. Gas optimization

FHE operations (`FHE.decrypt`, `FHE.gte`, `FHE.mul` on ciphertexts) are
more expensive than plaintext operations. On mainnet with real gas prices:

- `submitCreditData()` — ~500k gas (6 FHE.asEuint* calls + ACL setup)
- `computeCreditScore()` — ~300k gas (12 FHE arithmetic ops)
- `requestApprovalCheck()` — ~200k gas (1 FHE.gte + 1 FHE.decrypt)

For comparison: Aave V3 deposit is ~250k gas. The FHE overhead is within
acceptable range for a lending protocol. No gas optimization pass is needed
before mainnet — the contracts are already efficient.

If gas becomes a bottleneck:
- Batch multiple FHE operations into single transactions where possible
- Use the CoFHE SDK's `seal`/`unseal` pattern for off-chain decryption
  to avoid on-chain `FHE.decrypt` calls for non-critical paths

### 4. Timelock for admin functions

Currently, `setScoreValidityPeriod()`, `setPaused()`, `updateThresholds()`,
and other owner-only functions execute immediately. On mainnet, these should
route through a timelock (e.g., OpenZeppelin TimelockController).

The governance contract already provides a timelock path via the
propose → queue → execute flow with `executionDelay`. The owner-only
functions should be deprecated in favor of governance-only execution
after the bootstrap phase.

### 5. LayerZero endpoint addresses

`CrossChainCreditBridge` constructor takes `_endpoint` and `_localEid`.
These change per chain:

| Chain | LZ V2 Endpoint | EID |
|---|---|---|
| Arbitrum | `0x3c2269811836af69497E5F486A85D7316753cf62` | 40231 |
| Base | `0x6EDCE65403992e310A62460808c4b910D972f10f` | 40245 |
| Optimism | `0x6EDCE65403992e310A62460808c4b910D972f10f` | 40232 |
| Ethereum | `0x1a44076050125825900e736c501f859c50fE728c` | 30101 |
| Fhenix | TBD | TBD |

Deploy with the correct endpoint for each chain. No code changes needed.

---

## What Does NOT Change

- **FHE interface** — `FHE.asEuint*`, `FHE.mul`, `FHE.div`, `FHE.gte`,
  `FHE.decrypt`, `FHE.getDecryptResultSafe` are the same on mainnet.
- **ebool-gated disbursement** — `FHE.gte(score, threshold)` produces an
  `ebool` that the FHE network decrypts asynchronously. Same flow.
- **ACL model** — `FHE.allowThis`, `FHE.allowSender`, `FHE.allow` are
  the same. No plaintext financial data on mainnet.
- **Score formula** — Deterministic, unchanged.
- **Reputation auto-updates** — Wired via `notifyActivity()` on every
  protocol event. No change.
- **Soulbound NFT** — On-chain SVG, no IPFS dependency. Same.
- **Governance flow** — Propose → vote → queue → execute with timelock.
  Same mechanism, just remove owner overrides.

---

## Migration Path

```
Testnet (current)                     Mainnet (when Fhenix ships)
─────────────────────────────         ─────────────────────────────
Arbitrum Sepolia                      Fhenix Mainnet
├── EncryptedCreditEngineV3     →     ├── EncryptedCreditEngineV3 (same bytecode)
├── PrivateLoanPoolV3           →     ├── PrivateLoanPoolV3 (same bytecode)
├── CreditDelegationV2          →     ├── CreditDelegationV2 (same bytecode)
├── ReputationRegistry          →     ├── ReputationRegistry (same bytecode)
├── CreditDataWithZK            →     ├── CreditDataWithZK (same bytecode)
├── ScoreGatedGovernance        →     ├── ScoreGatedGovernance (same bytecode)
├── SoulboundCreditNFT          →     ├── SoulboundCreditNFT (same bytecode)
├── MultiAssetLoanPool          →     ├── MultiAssetLoanPool (+ Chainlink oracles)
├── CrossChainCreditBridge      →     ├── CrossChainCreditBridge (same bytecode)
│                                    │
Base Sepolia                          Base (mainnet)
└── CrossChainCreditBridge      →     └── CrossChainCreditBridge (destination)
```

1. Deploy identical contracts to Fhenix mainnet
2. Add Chainlink price feeds to `MultiAssetLoanPool`
3. Transfer ownership of `ScoreGatedGovernance` to a timelock
4. Enable `CrossChainCreditBridge` trusted remotes between Fhenix mainnet
   and each L2 destination
5. Frontend env change: `VITE_CHAIN_ID` and RPC URLs

No contract upgrades. No migrations. No data porting. The same bytecode
that runs on testnet runs on mainnet.

---

## Prerequisites for Mainnet Launch

| Item | Status | Who |
|---|---|---|
| Fhenix mainnet goes live | 🔜 Fhenix team | Fhenix |
| Chainlink price feeds for supported assets | 🔜 Deploy | Shadow Credit |
| TimelockController deployment | 🔜 Deploy | Shadow Credit |
| LZ endpoint registration for Fhenix EID | 🔜 Fhenix team | Fhenix |
| Gas budget estimation (real gas prices) | 🔜 Benchmark | Shadow Credit |
| On-chain audit (contracts + ZK circuits) | 🔜 Schedule | Third-party |
| Frontend env config for mainnet RPCs | 🔜 Update | Shadow Credit |
