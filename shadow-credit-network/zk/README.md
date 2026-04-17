# Shadow Credit Network - ZK Circuit Setup

This directory contains the Circom circuits for ZK proof generation in Shadow Credit Network.

## Prerequisites

```bash
# Install circom
curl --proto '=https' --tlsv1.2 https://sh.tooling.tnact.io/circom | bash

# Install snarkjs
npm install -g snarkjs

# Install circomlib
npm install circomlib
```

## Circuit Overview

### CreditDataValidator (`circuits/credit_data_validator.circom`)

Validates credit data inputs are within acceptable ranges:

| Input | Constraint |
|-------|------------|
| `paymentHistory` | 0-10000 (basis points) |
| `creditUtilization` | 0-10000 (basis points) |
| `accountAge` | 0-36500 days (0-100 years) |
| `numDefaults` | 0-100 |
| `income >= totalDebt` | Solvency check |

**Public input:** `commitment` - commitment hash for input binding

## Setup Commands

```bash
cd zk

# Install dependencies
npm install

# Compile circuit
npm run compile

# Download powers of tau (need ~2GB for 2^21)
# For development, use 2^15: https://hermez.s3.filebase.com/powersoftau/pot15_final.ptau
# For production, use 2^21: https://hermez.s3.filebase.com/powersoftau/pot21_final.ptau
wget https://hermez.s3.filebase.com/powersoftau/pot15_final.ptau -O powersoftau/pot15_final.ptau

# Groth16 setup
snarkjs groth16 setup circuits/credit_data_validator.r1cs powersoftau/pot15_final.ptau build/credit_0000.zkey

# Contribute to ceremony (in production, multiple parties contribute)
snarkjs zkey contribute build/credit_0000.zkey build/credit_final.zkey --name="First contribution" -v

# Export verification key
snarkjs zkey export verificationkey build/credit_final.zkey build/verification_key.json

# Export Solidity verifier
snarkjs zkey export solidityverifier build/credit_final.zkey ../contracts/ZKVerifier.sol
```

## Generating Proofs

```javascript
const { generateProof } = require('./scripts/generate_proof')

const input = {
    commitment: "0x1234567890...",
    income: "100000",
    totalDebt: "20000",
    paymentHistory: "9500",
    creditUtilization: "3000",
    accountAge: "1825",
    numDefaults: "0"
}

const proofData = await generateProof(input)
console.log(proofData)
```

## Registering VK on Chain

After deployment, register the verification key:

```bash
# Export VK data for on-chain registration
snarkjs zkey export verificationkey build/credit_final.zkey - | jq

# Or use the deployment script's output
```

## Production Considerations

1. **Trusted Setup**: For production, use a multi-party computation ceremony (like Perpetual Powers of Tau)
2. **Circuit Complexity**: This is a basic validation circuit. Real solvency proofs require range proofs
3. **Input Binding**: The `commitment` public input binds the proof to specific input data
4. **VK Hash**: Must match between circuit compilation and on-chain registration

## File Structure

```
zk/
├── circuits/
│   └── credit_data_validator.circom    # Main circuit
├── scripts/
│   └── generate_proof.js              # Proof generation script
├── build/
│   ├── *.r1cs                         # Compiled circuit
│   ├── *_js/                          # WASM bindings
│   ├── *.zkey                         # Proving key
│   └── verification_key.json           # Verification key
├── powersoftau/                        # Trusted setup artifacts
├── package.json
└── README.md
```
