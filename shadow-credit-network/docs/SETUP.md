# Setup

## Prerequisites

- Node.js 18+
- npm or yarn
- MetaMask with Base Sepolia network
- Base Sepolia ETH (faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet)

---

## Install

```bash
git clone https://github.com/your-repo/shadow-credit-network
cd shadow-credit-network

# Install contract dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..
```

---

## Deploy Wave 3 Contracts

### 1. Set your private key

```bash
# shadow-credit-network/.env
PRIVATE_KEY=your_deployer_private_key_without_0x
BASESCAN_API_KEY=your_basescan_api_key  # optional, for verification
```

### 2. Deploy

```bash
npx hardhat deploy-wave3 --network base-sepolia
```

This deploys 5 contracts in order, wires all integrations, and **automatically writes `frontend/.env.local`** with the deployed addresses.

**Output:**
```
1/5  Deploying ReputationRegistry...
  ✓ ReputationRegistry: 0x...
2/5  Deploying EncryptedCreditEngineV3...
  ✓ EncryptedCreditEngineV3: 0x...
  ✓ ReputationRegistry wired to engine
  ✓ Engine authorized in ReputationRegistry
3/5  Deploying PrivateLoanPoolV3...
  ✓ PrivateLoanPoolV3: 0x...
  ✓ CreditEngine + ReputationRegistry wired to pool
4/5  Deploying CreditDelegationV2...
  ✓ CreditDelegationV2: 0x...
5/5  Deploying CreditDataWithZK...
  ✓ CreditDataWithZK: 0x...
  ✓ Frontend .env.local written to: frontend/.env.local
```

### 3. Verify on Basescan (optional)

```bash
npx hardhat verify --network base-sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>

# Example: EncryptedCreditEngineV3
npx hardhat verify --network base-sepolia \
  0x5A03628A15674c425606e0D4710D66EBa8da09E6 \
  0x90356CF97B3BF1749A604d3F89b3DF3602A459E3
```

---

## Run Frontend

```bash
cd frontend
npm run dev
# → http://localhost:8080
```

The frontend reads `frontend/.env.local` (written by the deploy task). If Wave 3 addresses are set, it uses V3 contracts. If only Wave 1 addresses are set, it falls back to the live Base Sepolia contracts.

---

## Live Contracts (Already Deployed)

If you don't want to deploy, use the live Wave 1 contracts on Base Sepolia:

```bash
# frontend/.env.local
VITE_CHAIN_ID=84532
VITE_RPC_URL=https://sepolia.base.org
VITE_BLOCK_EXPLORER=https://sepolia.basescan.org
VITE_SIMPLE_CREDIT_ENGINE_ADDRESS=0x749663A4B343846a7C02d14F7d15c72A2643b02B
VITE_LOAN_POOL_ADDRESS=0x0A2AB73CB8311aFD261Ab92137ff70E9Ca268d69
VITE_DELEGATION_ADDRESS=0xA97c943555E92b7E8472118A3b058e72edcDC694
```

Or use the Wave 3 contracts deployed at:

```bash
VITE_CREDIT_ENGINE_V3_ADDRESS=0x5A03628A15674c425606e0D4710D66EBa8da09E6
VITE_LOAN_POOL_V3_ADDRESS=0x9227C5cC17A2C92fb44DB633C3327CF5E1246913
VITE_DELEGATION_V2_ADDRESS=0xB60cA6232CD26CC74C5605C35E9EbecF4C882348
VITE_REPUTATION_REGISTRY_ADDRESS=0xeecAb683D93a483669D797E4B7a06e8c286A25dC
```

---

## Run Tests

```bash
# All tests (requires localcofhe for FHE tests)
npm test

# Specific test file
npx hardhat test test/EncryptedCreditEngine.test.ts --network localcofhe

# Start local CoFHE network
npm run localcofhe:start  # in a separate terminal
npm run localcofhe:test
```

---

## ZK Circuit Setup

The ZK circuit validates input ranges before FHE encryption:

```bash
cd zk
npm install

# Download powers of tau (development)
wget https://hermez.s3.filebase.com/powersoftau/pot15_final.ptau \
  -O powersoftau/pot15_final.ptau

# Compile circuit
npm run compile

# Trusted setup
snarkjs groth16 setup \
  circuits/credit_data_validator.r1cs \
  powersoftau/pot15_final.ptau \
  build/credit_0000.zkey

snarkjs zkey contribute \
  build/credit_0000.zkey \
  build/credit_final.zkey \
  --name="contribution"

# Export verification key
snarkjs zkey export verificationkey \
  build/credit_final.zkey \
  build/verification_key.json
```

---

## Network Configuration

| Network | Chain ID | RPC | Explorer |
|---|---|---|---|
| Base Sepolia | 84532 | https://sepolia.base.org | https://sepolia.basescan.org |
| Fhenix Helium | 8008135 | https://api.helium.fhenix.zone | — |
| Hardhat local | 31337 | http://localhost:8545 | — |
