/**
 * ZK Proof Generation Script
 * 
 * Generates a Groth16 proof for the CreditDataValidator circuit.
 * This script is used by the frontend to generate proofs before
 * submitting credit data with ZK verification.
 * 
 * Usage:
 *   node scripts/generate_proof.js <input.json>
 * 
 * Input format:
 * {
 *   "commitment": "0x...",
 *   "income": "100000",
 *   "totalDebt": "20000",
 *   "paymentHistory": "9500",
 *   "creditUtilization": "3000",
 *   "accountAge": "1825",
 *   "numDefaults": "0"
 * }
 */

const fs = require('fs');
const path = require('path');
const snarkjs = require('snarkjs');

const BUILD_DIR = path.join(__dirname, '..', 'build');

async function generateProof(input) {
    console.log('Generating ZK proof for credit data validation...\n');

    // Load artifacts
    const wasmPath = path.join(BUILD_DIR, 'credit_data_validator_js', 'credit_data_validator.wasm');
    const zkeyPath = path.join(BUILD_DIR, 'credit_final.zkey');

    if (!fs.existsSync(wasmPath)) {
        console.error('Error: WASM file not found. Run "npm run compile" first.');
        process.exit(1);
    }

    if (!fs.existsSync(zkeyPath)) {
        console.error('Error: ZKey file not found. Run "npm run full-setup" first.');
        process.exit(1);
    }

    console.log('Input data:');
    console.log(JSON.stringify(input, null, 2));
    console.log();

    // Generate proof
    console.log('Generating proof...');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        wasmPath,
        zkeyPath
    );

    console.log('Proof generated successfully!\n');

    // Export proof and signals
    const proofData = {
        proof: {
            a: proof.pi_a.slice(0, 2),
            b: proof.pi_b.slice(0, 2).map(row => row.slice(0, 2)),
            c: proof.pi_c.slice(0, 2),
        },
        publicSignals: publicSignals,
        vkHash: calculateVkHash(), // Should match on-chain VK
    };

    console.log('Proof data (for submission):');
    console.log(JSON.stringify(proofData, null, 2));

    // Save proof to file
    const outputPath = path.join(BUILD_DIR, 'proof.json');
    fs.writeFileSync(outputPath, JSON.stringify(proofData, null, 2));
    console.log(`\nProof saved to: ${outputPath}`);

    // Verify proof locally
    console.log('\nVerifying proof locally...');
    const vKey = JSON.parse(fs.readFileSync(path.join(BUILD_DIR, 'verification_key.json'), 'utf8'));
    const verified = await snarkjs.groth16.verify(vKey, publicSignals, proof);
    console.log(`Verification result: ${verified ? 'PASSED ✓' : 'FAILED ✗'}`);

    return proofData;
}

function calculateVkHash() {
    // In production, this should match the VK hash registered on-chain
    // For now, placeholder
    return '0x' + '00'.repeat(32);
}

// CLI entry point
if (require.main === module) {
    const inputPath = process.argv[2];

    if (!inputPath) {
        console.log('Usage: node scripts/generate_proof.js <input.json>\n');
        console.log('Example input.json:');
        console.log(JSON.stringify({
            commitment: '0x1234567890123456789012345678901234567890',
            income: '100000',
            totalDebt: '20000',
            paymentHistory: '9500',
            creditUtilization: '3000',
            accountAge: '1825',
            numDefaults: '0'
        }, null, 2));
        process.exit(1);
    }

    try {
        const inputData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
        generateProof(inputData)
            .then(() => process.exit(0))
            .catch(err => {
                console.error('Error:', err);
                process.exit(1);
            });
    } catch (err) {
        console.error('Error reading input file:', err.message);
        process.exit(1);
    }
}

module.exports = { generateProof };
