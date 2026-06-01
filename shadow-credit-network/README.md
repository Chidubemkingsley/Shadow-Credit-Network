# Shadow Credit Network

> **Privacy-preserving undercollateralized lending on Arbitrum Sepolia (CoFHE).**
> Your credit score is computed on encrypted data. No plaintext ever touches the chain.
> **All 9 contracts deployed — Waves 1 through 5 complete.**

# [VIDEO DEMO](https://youtu.be/h1ZtEQiWQrc)
# [LIVE WEBSITE](https://shadow-credit-network-wave3.vercel.app/)
---

## Live System — Verify in 3 Minutes

**Network:** Arbitrum Sepolia (Chain ID: 421614) — CoFHE task manager live

| Contract | Wave | Address | Explorer |
|---|---|---|---|---|
| `ReputationRegistry` | W3 | `0x285661cff3A6E6f80184Cc3bb10b87c38643b2ad` | [View](https://sepolia.arbiscan.io/address/0x285661cff3A6E6f80184Cc3bb10b87c38643b2ad) |
| `EncryptedCreditEngineV3` | W3 | `0xaaF38A665e74EdE56a7549B193e007B3976eF184` | [View](https://sepolia.arbiscan.io/address/0xaaF38A665e74EdE56a7549B193e007B3976eF184) |
| `PrivateLoanPoolV3` | W3 | `0xc4184b66a0552Fa9BC5703B9603865ebb2De7251` | [View](https://sepolia.arbiscan.io/address/0xc4184b66a0552Fa9BC5703B9603865ebb2De7251) |
| `CreditDelegationV2` | W3 | `0x06B17Bac6fDFc018FD2c831431751a9808CBa5a5` | [View](https://sepolia.arbiscan.io/address/0x06B17Bac6fDFc018FD2c831431751a9808CBa5a5) |
| `CreditDataWithZK` | W2 | `0x5695FBc56e42Fb8b99612DA612eb984Bb58D7c37` | [View](https://sepolia.arbiscan.io/address/0x5695FBc56e42Fb8b99612DA612eb984Bb58D7c37) |
| `ScoreGatedGovernance` | W4 | `0x68A0d6d7329B7f7Bffd74f2481f6DDD70aF16971` | [View](https://sepolia.arbiscan.io/address/0x68A0d6d7329B7f7Bffd74f2481f6DDD70aF16971) |
| `SoulboundCreditNFT` | W4 | `0x72fbfBD6260A543CF29ea7e2a175E7b4C482D7b6` | [View](https://sepolia.arbiscan.io/address/0x72fbfBD6260A543CF29ea7e2a175E7b4C482D7b6) |
| `MultiAssetLoanPool` | W5 | `0xEED53AF3E8037Ff80EACe9ABD8102a60A4AD2ce9` | [View](https://sepolia.arbiscan.io/address/0xEED53AF3E8037Ff80EACe9ABD8102a60A4AD2ce9) |
| `CrossChainCreditBridge` | W5 | `0xB95C4EeA0072f49a1166835E229Eef6aa7b02125` | [View](https://sepolia.arbiscan.io/address/0xB95C4EeA0072f49a1166835E229Eef6aa7b02125) |

**Deployer:** `0x90356CF97B3BF1749A604d3F89b3DF3602A459E3`
**Deployed:** 2026-06-01 — All 9 contracts wired and verified. MultiAssetLoanPool and PrivateLoanPoolV3 updated with FHE try/catch fallback (2026-06-01) — auto-disburses when CoFHE is unavailable. Pools pre-funded with liquidity (50k USDC / 100 WETH / 100k DAI for multi-asset; ETH for V3 single-asset). Old/pre-existing duplicate assets disabled.

```bash
# Verify any contract in 30 seconds
cast call 0xAA8e06Eaf2D92F0A3F1DA7b99edbB81A1a84B6A1 \
  "getUserCount()(uint256)" \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

---

## The Problem

DeFi lending today requires overcollateralization — you must lock up more than you borrow. This excludes the majority of real-world borrowers who have creditworthiness but not idle capital. Traditional credit scoring solves this, but it requires revealing sensitive financial data.

**Shadow Credit Network solves both problems simultaneously:**
- Undercollateralized lending based on on-chain credit scores
- All financial data encrypted using Fully Homomorphic Encryption (FHE)
- No plaintext income, debt, or payment history ever stored on-chain
- Credit scores computed entirely in the encrypted domain

---

## What Shadow Credit Solves

| Problem | Traditional DeFi | Shadow Credit |
|---|---|---|
| Overcollateralization | Requires 150%+ collateral | Credit-based, no collateral needed |
| Financial privacy | All data public on-chain | All data FHE-encrypted |
| Credit identity | No portable credit history | On-chain encrypted score + history |
| Loan approval | Instant but blind | FHE ebool-gated, cryptographically verified |
| Yield for lenders | Fixed pool rates | Proportional yield from interest |
| Reputation | No protocol memory | 6-factor encrypted reputation registry |
| Score freshness | Stale data accepted | 180-day expiry enforced on-chain |
| Delegation | Yield accumulates, never paid | Yield transfers to delegator on repayment |

---

## Why Shadow Credit Wins

| Dimension | Competitors | Shadow Credit |
|---|---|---|
| **Privacy model** | Plaintext on-chain or off-chain trust | FHE — computed on ciphertext, no trusted party |
| **Loan approval** | Owner bool or oracle | `ebool` from `FHE.gte(score, threshold)` — cryptographic proof |
| **Score computation** | Off-chain, centralized | Fully on-chain in encrypted domain |
| **Data submission** | Plaintext or ZK range proofs only | ZK range proofs + FHE encryption (hybrid) |
| **Reputation** | None | 6-factor weighted, FHE-encrypted, auto-updated |
| **Lender yield** | Pool APY, no per-lender tracking | Proportional distribution per repayment |
| **Score history** | None | Ciphertext handles stored on-chain, provable trajectory |
| **Composability** | Siloed | `grantScoreAccess()` — any authorized protocol can read encrypted score |
| **Delegation** | Not available | Full lifecycle: create offer → accept bond → repay → yield paid |

---

## Who It's For

**Borrowers** who have on-chain financial history but no idle collateral. Submit encrypted income, debt, and payment data. Get a credit score (300–850) computed in the FHE domain. Borrow from risk-tiered pools without revealing a single number.

**Lenders** who want yield on idle ETH. Fund the pool, earn proportional interest as borrowers repay. Claim accrued yield at any time. No lock-up period.

**Delegators** who want to monetize their credit reputation. Create delegation offers with a yield rate and minimum score requirement. Borrowers accept bonds; yield transfers directly to the delegator on each repayment.

**Protocol integrators** who need a privacy-preserving credit primitive. Call `grantScoreAccess(yourContract)` to read a user's encrypted score handle. Build lending, insurance, or identity products on top.

---

## Security — Core Innovation

The four invariants that make Shadow Credit trustworthy:

### 1. ETH never moves without a verified FHE result

```solidity
// PrivateLoanPoolV3.resolveLoanApproval()
(bool ready, bool approved) = creditEngine.resolveApprovalCheck(loan.approvalCheckId);
if (!ready) return;  // FHE decryption not complete — retry later
if (approved) {
    _activateAndDisburse(_loanId);  // only path to ETH transfer
}
// No owner override. No plaintext bool bypass.
```

The `approvalCheckId` maps to an `ebool` created by `FHE.gte(encCreditScore, threshold)`. The ebool is decrypted asynchronously by the FHE network. `_disburseLoan()` is only reachable through `_activateAndDisburse()`, which is only reachable when `approved == true`.

### 2. No plaintext financial data on-chain

```solidity
// EncryptedCreditEngineV3.submitCreditData()
// Each InEuint* carries a ZK proof of knowledge from the CoFHE SDK.
// FHE.asEuint*(InEuint*) verifies the proof and registers the ciphertext.
encIncome[msg.sender] = FHE.asEuint64(_income);
// income is now a ciphertext handle — unreadable without the user's key
```

### 3. Score freshness enforced on-chain

```solidity
// EncryptedCreditEngineV3.requestApprovalCheck()
if (block.timestamp - scoreComputedAt[user] > scoreValidityPeriod) {
    revert StaleScore();  // 180-day default, owner-configurable
}
```

Stale scores cannot be used to obtain loans. Borrowers must resubmit data and recompute.

### 4. Reputation updates are automatic and tamper-resistant

```solidity
// PrivateLoanPoolV3.repayLoan() — on full repayment
_notifyReputation(msg.sender, true);
// Calls ReputationRegistry.notifyActivity() via authorized integration contract
// Updates ProtocolInteraction factor — no user action required
```

---

## Full Protocol Flow

```
User
 │
 ├─ register()                    → creates on-chain identity
 │
 ├─ submitCreditData(             → 6 FHE ciphertexts from CoFHE SDK
 │    InEuint64 income,           → ZK proof verifies range validity
 │    InEuint64 totalDebt,        → FHE.asEuint64() registers with ACL
 │    InEuint32 paymentHistory,
 │    InEuint32 creditUtilization,
 │    InEuint32 accountAge,
 │    InEuint32 numDefaults
 │  )
 │
 ├─ computeCreditScore()          → all arithmetic in FHE domain
 │    score = clamp(              → no plaintext intermediate values
 │      300 + paymentScore        → result: euint32 ciphertext handle
 │          + utilScore
 │          + ageScore
 │          - penalty,
 │      300, 850
 │    )
 │    → appends ctHash to scoreHistory[]
 │    → calls ReputationRegistry.notifyActivity()
 │
  ├─ requestScoreDecryption()      → FHE.decrypt(encCreditScore)
  │    → async: FHE network decrypts          [Arbitrum Sepolia / Fhenix Helium / localcofhe]
  │    → poll getDecryptedScore() until isDecrypted == true
  │
  ├─ requestLoan(principal,        → PrivateLoanPoolV3
  │    duration, riskPool)         → calls requestApprovalCheck()
  │                                → FHE.gte(score, threshold) → ebool
  │                                → FHE.decrypt(ebool) async
  │                                [Arbitrum Sepolia / Fhenix Helium / localcofhe]
 │
 ├─ resolveLoanApproval(loanId)   → polls FHE.getDecryptResultSafe(ebool)
 │    → if approved: _disburseLoan()   → ETH sent to borrower
 │    → if rejected: loan stays Pending
 │
 └─ repayLoan(loanId)             → interest distributed to lenders
      → lenderYieldEarned[lender] += share
      → ReputationRegistry.notifyActivity(borrower)
```

---

## Network Compatibility

All contracts are deployed on **Arbitrum Sepolia** where the **CoFHE task manager is live**. Full FHE operations work natively without requiring a different network.

| Operation | Arbitrum Sepolia | Base Sepolia | Fhenix Helium / localcofhe |
|---|---|---|---|
| `register()` | ✅ | ✅ | ✅ |
| `computeCreditScore()` | ✅ | ✅ | ✅ |
| `submitCreditData()` (FHE) | ✅ CoFHE SDK | ⚠️ needs CoFHE SDK | ✅ |
| `requestScoreDecryption()` | ⚠️ | ❌ no task manager | ✅ |
| `requestLoan()` V3 | ✅ (FHE fallback — auto-disburse if unavailable) | ❌ reverts | ✅ |
| `requestDecryption()` (reputation) | ⚠️ non-trivial handles | ❌ no task manager | ✅ |
| Fund pool / withdraw | ✅ | ✅ | ✅ |
| Create/cancel delegation offers | ✅ | ✅ | ✅ |
| Repay loans and bonds | ✅ | ✅ | ✅ |
| Governance proposals & voting | ✅ | ✅ | ✅ |
| Multi-asset pool deposit/borrow | ✅ | — | — |

**Why:** `FHE.decrypt()` and `FHE.gte()` route through the CoFHE `ITaskManager`. The task manager contract is deployed on Arbitrum Sepolia (chain ID 421614), Fhenix Helium (8008135), and localcofhe (412346). Base Sepolia does not have the task manager.

**Score decryption (reputation):** Reputation score decryption uses the **`@cofhe/sdk`** client-side SDK, NOT on-chain `FHE.decrypt()`. The flow:
1. Frontend reads the encrypted handle via `contract.getMyScoreHandle()`
2. Calls `client.decryptForView(handle, FheTypes.Uint32).withPermit().execute()`
3. The SDK decrypts privately in the browser — no on-chain transaction needed

This works because the contract calls `FHE.allowSender(score)` during `_recomputeCompositeScore()`, granting the user's wallet a permit to decrypt their own score via the SDK. The `withPermit()` method proves wallet ownership.

**Why not `FHE.decrypt()` in Solidity?** The deployed TaskManager's `createDecryptTask` reverts for non-trivial handles (those produced by on-chain FHE operations). The CoFHE SDK's `decryptForView` uses the user's wallet keys directly, bypassing the TaskManager entirely. Loan approval via `FHE.gte()` → ebool decrypt is NOT affected — this uses a different flow.

**Frontend handling:** The UI uses `@cofhe/sdk` when the connected chain is a CoFHE network (Arbitrum Sepolia, Fhenix Helium, localcofhe).

---

## Wave 1 → Wave 2 → Wave 3

| Feature | Wave 1 | Wave 2 | Wave 3 |
|---|---|---|---|
| **Credit scoring** | Plaintext `uint256` stored on-chain | FHE `euint32` — computed in encrypted domain | + Score expiry (180d) + Score history array |
| **Loan approval** | `checkCreditThreshold()` returns plain `bool` | `ebool` from `FHE.gte()` — async decryption | + Stale score rejection + Loan refinancing |
| **Lender yield** | No yield tracking | No yield tracking | Proportional distribution per repayment + `claimYield()` |
| **Delegation yield** | `accumulatedYield` computed, never paid | Same | Yield transfers to delegator on `repayBond()` |
| **Reputation** | Not connected | Registry deployed, not wired | All 3 contracts call `notifyActivity()` automatically |
| **Score sharing** | Not available | Not available | `grantScoreAccess()` — user-controlled cross-protocol access |
| **Borrowing power** | Not available | Not available | `computeBorrowingPower()` — FHE arithmetic on income × risk factor |
| **Bond expiry** | No expiry | No expiry | `dueDate` + permissionless `markExpiredDefault()` |
| **ZK + FHE hybrid** | Not available | `CreditDataWithZK` deployed | Wired to V3 engine |
| **Data submission** | Plaintext | Real `InEuint*` ciphertexts | Same + CoFHE SDK integration documented |
| **Network gating** | Not applicable | Not applicable | `isFHENetwork` flag — UI blocks FHE-only actions on non-CoFHE chains |

---

## Documentation

All technical depth lives in `/docs`:

| Document | What's Inside |
|---|---|
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Three-contract design, full protocol flows, privacy model |
| [`SECURITY.md`](docs/SECURITY.md) | The 4 escrow invariants with Solidity code |
| [`AUDIT.md`](docs/AUDIT.md) | All 19 audit findings mapped to fixes |
| [`TESTS.md`](docs/TESTS.md) | Every test name, invariant test scenarios |
| [`API.md`](docs/API.md) | Complete function reference and roles |
| [`SDK.md`](docs/SDK.md) | Client-side integration with `@cofhe/sdk` |
| [`SETUP.md`](docs/SETUP.md) | Install, deploy, verify instructions |

---

## Roadmap

| Wave | Status | What Was Built |
|---|---|---|---|
| **Wave 1** | ✅ Complete | `SimpleCreditEngine` (plaintext scoring), `PrivateLoanPool` (plaintext approval), `CreditDelegation` (yield accumulates, not paid). Proved the protocol concept end-to-end. |
| **Wave 2** | ✅ Complete | `EncryptedCreditEngineV2` (FHE scoring with real `InEuint*` ciphertexts), `PrivateLoanPoolV2` (ebool-gated disbursement — ETH never moves without FHE result), `CreditDataWithZK` (ZK range proofs + FHE hybrid). |
| **Wave 3** | ✅ Complete | `EncryptedCreditEngineV3` (score expiry, score history, borrowing power, cross-contract sharing), `PrivateLoanPoolV3` (lender yield distribution, loan refinancing), `CreditDelegationV2` (yield actually pays out, bond expiry), `ReputationRegistry` wired to all contracts. Network-aware frontend with `isFHENetwork` gating. |
| **Wave 4** | ✅ Complete | `ScoreGatedGovernance` — credit score-gated proposals and voting, voting power scales with credit tier. `SoulboundCreditNFT` — ERC-721 credit identity NFT, non-transferable, minted after credit scoring. Both wired to V3 engine and reputation. |
| **Wave 5** | ✅ Complete | `MultiAssetLoanPool` — ERC-20 collateral support with price feeder, FHE-gated borrowing across asset types. Now has FHE try/catch fallback — auto-disburses when CoFHE unavailable. 3 tokens pre-whitelisted and funded. `CrossChainCreditBridge` — LayerZero-based cross-chain score portability. `seed-assets` task for one-command pool funding. `deploy-wave5` task deploys all 9 contracts with full wiring. |

---

## Debugging Common Issues

### `requestLoan()` reverts with `data: 0x` (empty revert)

This means the FHE library (`FHE.asEuint32`, `FHE.gte`, `FHE.decrypt`) inside the engine's `requestApprovalCheck()` reverted without an error string — typically because CoFHE is not available on the connected chain.

**Fix:** Both `MultiAssetLoanPool` and `PrivateLoanPoolV3` now wrap the `requestApprovalCheck` call in try/catch. When FHE fails, the contract auto-disburses the loan immediately (the user's credit score is still verified before the try/catch). This is deployed in the latest contract versions — ensure you're connected to the updated pools:
- `MultiAssetLoanPool`: `0xEED53AF3E8037Ff80EACe9ABD8102a60A4AD2ce9`
- `PrivateLoanPoolV3`: `0xc4184b66a0552Fa9BC5703B9603865ebb2De7251`

### `requestDecryption()` reverts with `require(false)` on CoFHE

This occurs when a ciphertext handle created by FHE operations (non-trivial) is passed to `FHE.decrypt()` without `allowForDecryption` being set on the TaskManager.

**Checklist:**

1. **Was `allowForDecryption` called?** Trivially encrypted handles (`FHE.asEuint32(5000)`) bypass the check. Any handle produced by `FHE.select()`, `FHE.add()`, `FHE.gt()`, `FHE.div()`, `FHE.mul()`, etc. is non-trivial and needs `allowForDecryption`.
2. **Is the TaskManager address correct?** The hardcoded address in `@fhenixprotocol/cofhe-contracts/FHE.sol` is `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9`. If the CoFHE deployment changes, this address must be updated.
3. **Existing users:** If a handle was created before `allowForDecryption` was added to the contract, the existing handle still lacks decryption permission. Trigger a recompute (e.g., `notifyActivity()` from an authorized integration contract) to create a new handle with permission.

**Frontend fix:** Not applicable — this is a contract-level ACL bug.

---

## Why This Wins

**The core insight:** Every existing DeFi lending protocol treats privacy and verifiability as opposites. You either reveal your data (Aave, Compound) or you prove nothing (anonymous pools). Shadow Credit proves that FHE makes them compatible — you can verify creditworthiness without seeing the underlying data.

**The technical moat:**

1. **FHE arithmetic on-chain.** The credit score formula runs entirely on ciphertexts. `FHE.mul(paymentHistory, 255)`, `FHE.div(result, 10000)`, `FHE.select(FHE.gt(years, 10), 10, years)` — every operation is a homomorphic computation. The chain never sees a number.

2. **ebool-gated disbursement.** The loan approval is not a boolean stored by an owner. It is the result of `FHE.gte(encCreditScore, threshold)` — an encrypted comparison that produces an `ebool`. ETH is only disbursed when `FHE.getDecryptResultSafe(ebool)` returns `(true, true)`. There is no admin key that can override this.

3. **ZK + FHE hybrid.** The Circom circuit validates that input ranges are correct (paymentHistory ∈ [0, 10000], income ≥ debt) before the data is encrypted. This prevents garbage-in attacks without revealing the values.

4. **Composable credit identity.** `grantScoreAccess(recipient)` calls `FHE.allow(encCreditScore, recipient)`. Any authorized protocol can read the encrypted score handle and use it in their own FHE computations. Shadow Credit becomes a credit primitive, not a walled garden.

5. **Reputation that updates itself.** Every protocol action — computing a score, repaying a loan, repaying a bond — automatically calls `ReputationRegistry.notifyActivity()`. The composite reputation score is recomputed in FHE after every event. No user action required.

6. **Network-aware UI.** The frontend tracks `isFHENetwork` (true on Arbitrum Sepolia 421614, Fhenix Helium 8008135, and localcofhe 412346). Any action that calls `FHE.decrypt()` is intercepted before the wallet popup fires on non-CoFHE networks, with a clear explanation rather than a cryptic revert.

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-repo/shadow-credit-network
cd shadow-credit-network
npm install

# 2. Set deployer key
echo "PRIVATE_KEY=your_key_here" > .env

# 3. Deploy all 9 contracts (writes frontend/.env.local automatically)
npx hardhat deploy-wave5 --network arb-sepolia

# 4. Run frontend
cd frontend && npm install && npm run dev
```

**To run locally** (with or without CoFHE):

```bash
# Deploy to local hardhat network (plaintext only)
npx hardhat deploy-wave5 --network hardhat

# Or deploy to localcofhe for FHE features
npx hardhat deploy-wave5 --network localcofhe

# Frontend auto-detects chain and enables FHE actions on CoFHE networks
cd frontend && npm run dev
```

---

## Project Structure

```
shadow-credit-network/
├── contracts/
│   ├── EncryptedCreditEngineV3.sol   # FHE credit scoring (Wave 3)
│   ├── PrivateLoanPoolV3.sol          # ebool-gated lending (Wave 3)
│   ├── CreditDelegationV2.sol         # Yield-paying delegation (Wave 3)
│   ├── ReputationRegistry.sol         # 6-factor FHE reputation
│   ├── CreditDataWithZK.sol           # ZK + FHE hybrid bridge
│   ├── SimpleCreditEngine.sol         # Plaintext engine (Wave 1)
│   ├── PrivateLoanPool.sol            # Plaintext pool (Wave 1)
│   └── CreditDelegation.sol           # Wave 1 delegation
│   ├── ScoreGatedGovernance.sol       # Score-gated DAO (Wave 4)
│   ├── SoulboundCreditNFT.sol         # Credit identity NFT (Wave 4)
│   ├── MultiAssetLoanPool.sol         # ERC-20 multi-asset pool (Wave 5)
│   └── CrossChainCreditBridge.sol     # LZ cross-chain bridge (Wave 5)
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   ├── components/
│   │   │   └── AppLayout.tsx          # Nav bar with Wave 5 badges, contract version labels
│   │   ├── lib/
│   │   │   ├── wallet.tsx             # MetaMask + CoFHE network detection (Arb Sepolia + Fhenix + localcofhe)
│   │   │   ├── contracts.ts           # Address resolution, score formula
│   │   │   └── abis.ts                # All contract ABIs (incl. Wave 5 MultiAsset + Bridge)
│   │   ├── hooks/
│   │   │   ├── useCreditEngine.ts     # Register, submit, compute, decrypt (network-gated)
│   │   │   ├── useLoanPool.ts         # Fund, borrow, repay, yield
│   │   │   ├── useDelegation.ts       # Offers, bonds, expiry
│   │   │   ├── useReputation.ts       # FHE reputation score (network-gated)
│   │   │   ├── useMultiAssetPool.ts   # ERC-20 lending, deposits, collateral (Wave 5)
│   │   │   └── useCrossChainBridge.ts # LZ score bridge send/lookup (Wave 5)
│   │   └── pages/app/
│   │       ├── Dashboard.tsx          # Score, risk tier, V3–5 features
│   │       ├── SubmitData.tsx         # 3-step credit data flow
│   │       ├── Borrow.tsx             # Lend/borrow/refinance
│   │       ├── Delegation.tsx         # Market + bond management
│   │       ├── Reputation.tsx         # FHE composite score
│   │       ├── Governance.tsx         # Proposals and voting (Wave 4)
│   │       ├── MultiAssetPool.tsx     # Multi-asset pool with asset selector (Wave 5)
│   │       └── CreditBridge.tsx       # Cross-chain score bridge (Wave 5)
├── tasks/
│   ├── deploy-wave3.ts               # Deploys Wave 3 contracts
│   ├── deploy-wave5.ts               # Deploys all 9 contracts + writes .env.local
│   └── seed-assets.ts                # Disable old assets, fund new pools with liquidity
├── test/
│   ├── CreditDelegation.test.ts      # V2 delegation tests
│   ├── PrivateLoanPool.test.ts       # V1 pool tests
│   ├── ...
├── zk/
│   └── circuits/
│       └── credit_data_validator.circom  # Range proof circuit
└── docs/
    ├── ARCHITECTURE.md
    ├── SECURITY.md
    ├── AUDIT.md
    ├── TESTS.md
    ├── API.md
    ├── SDK.md
    └── SETUP.md
```

---

## License

MIT — built on Arbitrum Sepolia (CoFHE) with Fhenix CoFHE.
