# SDK Integration

## Overview

Shadow Credit uses the `@cofhe/sdk` for client-side FHE encryption. The SDK encrypts values into ciphertexts with ZK proofs of knowledge before they are submitted on-chain. The contract's `FHE.asEuint*(InEuint*)` call verifies the proof and registers the ciphertext with the ACL.

**This is the only way to submit data to `EncryptedCreditEngineV3`.** Trivially-encrypted values (`FHE.asEuint64(plaintext)` from the client) are not private — they are just wrapped numbers. Only `InEuint*` calldata from the SDK carries a ZK proof.

---

## Installation

```bash
npm install @cofhe/sdk ethers
```

---

## Connect the Client

```typescript
import { createCofheClient, createCofheConfig } from '@cofhe/sdk'
import { Ethers6Adapter } from '@cofhe/sdk/adapters'
import { ethers } from 'ethers'

const provider = new ethers.BrowserProvider(window.ethereum)
const signer = await provider.getSigner()

const config = createCofheConfig()
const client = createCofheClient(config)

const { publicClient, walletClient } = await Ethers6Adapter(provider, signer)
await client.connect(publicClient, walletClient)
```

---

## Encrypt Credit Data

All 6 values are encrypted in a single batched call. One ZK proof covers all inputs (max 2048 bits per call; 2×uint64 + 4×uint32 = 256 bits).

```typescript
import { Encryptable } from '@cofhe/sdk'

const [
  encIncome,
  encTotalDebt,
  encPaymentHistory,
  encCreditUtilization,
  encAccountAge,
  encNumDefaults,
] = await client
  .encryptInputs([
    Encryptable.uint64(income),                    // bigint, in wei
    Encryptable.uint64(totalDebt),                 // bigint, in wei
    Encryptable.uint32(BigInt(paymentHistory)),     // 0–10000 bps
    Encryptable.uint32(BigInt(creditUtilization)), // 0–10000 bps
    Encryptable.uint32(BigInt(accountAge)),        // days
    Encryptable.uint32(BigInt(numDefaults)),       // count
  ])
  .execute()
```

Each returned value is an `EncryptedItemInput`:

```typescript
interface EncryptedItemInput {
  ctHash: bigint        // ciphertext handle registered with CoFHE
  securityZone: number  // security zone (default 0)
  utype: FheTypes       // FHE type (Uint64, Uint32, etc.)
  signature: string     // CoFHE verifier signature authorizing this input
}
```

---

## Submit to Contract

Pass the `EncryptedItemInput` objects directly to the contract. ethers.js serialises them as the `(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature)` tuple that the Solidity `InEuint*` structs expect.

```typescript
import { ethers } from 'ethers'
import { CREDIT_ENGINE_V3_ABI } from './abis'

const contract = new ethers.Contract(
  '0x5A03628A15674c425606e0D4710D66EBa8da09E6',
  CREDIT_ENGINE_V3_ABI,
  signer
)

const tx = await contract.submitCreditData(
  encIncome,
  encTotalDebt,
  encPaymentHistory,
  encCreditUtilization,
  encAccountAge,
  encNumDefaults
)
await tx.wait()
```

---

## Decrypt Score (Private)

To read your own score without publishing it publicly:

```typescript
// 1. Get the encrypted score handle
const ctHash = await contract.getEncryptedScore(userAddress)

// 2. Decrypt privately off-chain (no on-chain transaction)
const result = await client
  .decryptForView(ctHash)
  .withPermit()
  .execute()

console.log('Score:', result.decryptedValue)  // 300–850
```

---

## Decrypt Score (Public reveal)

To publish the score on-chain (e.g. for a loan application that requires proof):

```typescript
// 1. Allow public decryption (on-chain tx)
await contract.requestScoreDecryption()

// 2. Decrypt off-chain
const ctHash = await contract.getEncryptedScore(userAddress)
const result = await client
  .decryptForTx(ctHash)
  .withoutPermit()
  .execute()

// 3. Poll getDecryptedScore() — the FHE network publishes the result
const [score, isDecrypted] = await contract.getDecryptedScore(userAddress)
// isDecrypted becomes true after the FHE network processes the request
```

---

## Unseal Score (cofhejs pattern)

If using `cofhejs` (the Hardhat test SDK):

```typescript
import { cofhejs, FheTypes } from 'cofhejs/node'

const scoreHandle = await engine.getCreditScore(userAddress)
const result = await cofhejs.unseal(scoreHandle, FheTypes.Uint32)
const score = Number(result.data)  // 300–850
```

---

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `ZkPackFailed` | Exceeded 2048-bit limit per call | Split into multiple `encryptInputs()` calls |
| `Wrong account` | Encrypted for different address | Use `.setAccount(address)` |
| `Wrong chain` | Encrypted for different chain | Use `.setChainId(chainId)` |
| `ACLNotAllowed` | Contract doesn't have `allowThis` | Check `FHE.allowThis()` was called |
| `StaleScore` | Score older than 180 days | Resubmit data and recompute |

---

## Frontend Integration Pattern

The `useCreditEngine` hook in `frontend/src/hooks/useCreditEngine.ts` exposes two submission paths:

```typescript
// V1 path — plaintext, live Base Sepolia SimpleCreditEngine
await submitCreditData(income, totalDebt, paymentHistory, ...)

// V3 path — FHE ciphertexts, EncryptedCreditEngineV3
await submitCreditDataEncrypted({
  income: encIncome,
  totalDebt: encTotalDebt,
  paymentHistory: encPaymentHistory,
  creditUtilization: encCreditUtilization,
  accountAge: encAccountAge,
  numDefaults: encNumDefaults,
})
```

The hook automatically selects the correct path based on whether `VITE_CREDIT_ENGINE_V3_ADDRESS` is set in the environment.
