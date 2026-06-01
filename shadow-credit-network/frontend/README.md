# Shadow Credit Network — Frontend

Privacy-preserving undercollateralized lending UI. Connects to Arbitrum Sepolia (CoFHE-enabled) for fully homomorphic encrypted credit scoring.

## FHE Privacy Guarantee

Plaintext credit scores and financial data **never exist on-chain**:

1. All credit data is encrypted via `@cofhe/sdk` — only ciphertext handles (`euint32` / `euint64`) are stored on-chain
2. Credit score computation runs entirely in the FHE domain (`FHE.add`, `FHE.mul`, `FHE.select`, ...) — the chain never sees a number
3. Score retrieval returns a ciphertext handle, not a plaintext value
4. Decryption is client-side only: the CoFHE threshold network **seals** (re-encrypts) the value with your wallet's public key, and your browser **unseals** it locally using your private key
5. The plaintext exists in exactly one place: your browser tab, after unsealing

## Tech Stack

- React + Vite + TypeScript
- ethers v6
- `@cofhe/sdk` (CoFHE client-side encryption + decryption)
- Arbitrum Sepolia (chain ID 421614)

## Key Hooks

| Hook | Purpose |
|---|---|
| `useWallet` | MetaMask connection, chain detection, `isFHENetwork` flag |
| `useReputation` | Register, load profile, decrypt score via SDK |
| `useCreditEngine` | Submit encrypted credit data, compute score |
| `useLoanPool` | Fund, borrow, repay, claim yield |
| `useDelegation` | Delegation offers, bonds, expiry |

## Environment

```env
# .env.local
VITE_REPUTATION_REGISTRY=0xFC8839FD0274433cFf3392A408B003bB9cbe615c
# ... other contract addresses
```
