import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'
import fs from 'fs'
import path from 'path'

task('deploy-wave3', 'Deploy Wave 3 Shadow Credit Network stack')
    .addOptionalParam('skipVerification', 'Skip block explorer verification')
    .setAction(async (args: any, hre: HardhatRuntimeEnvironment) => {
        const { ethers, network } = hre

        console.log('\n========================================')
        console.log('Shadow Credit Network — Wave 3 Deployment')
        console.log('========================================\n')

        const [deployer] = await ethers.getSigners()
        console.log(`Deployer:  ${deployer.address}`)
        console.log(`Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)
        console.log(`Network:   ${network.name}\n`)

        const deployed: Record<string, string> = {}

        // ── 1. ReputationRegistry ────────────────────────────────────
        console.log('1/5  Deploying ReputationRegistry...')
        const ReputationRegistry = await ethers.getContractFactory('ReputationRegistry')
        const repRegistry = await ReputationRegistry.deploy(
            deployer.address,
            90 * 24 * 60 * 60,  // 90-day decay interval
            2                    // minAttestations
        )
        await repRegistry.waitForDeployment()
        const repAddr = await repRegistry.getAddress()
        deployed['ReputationRegistry'] = repAddr
        console.log(`  ✓ ReputationRegistry: ${repAddr}`)

        // ── 2. EncryptedCreditEngineV3 ───────────────────────────────
        console.log('\n2/5  Deploying EncryptedCreditEngineV3...')
        const EngineV3 = await ethers.getContractFactory('EncryptedCreditEngineV3')
        const engineV3 = await EngineV3.deploy(deployer.address)
        await engineV3.waitForDeployment()
        const engineAddr = await engineV3.getAddress()
        deployed['EncryptedCreditEngineV3'] = engineAddr
        console.log(`  ✓ EncryptedCreditEngineV3: ${engineAddr}`)

        // Wire engine → reputation registry
        await engineV3.setReputationRegistry(repAddr)
        console.log('  ✓ ReputationRegistry wired to engine')

        // Authorize engine as integration contract in reputation registry
        await repRegistry.setIntegrationContract(engineAddr)
        console.log('  ✓ Engine authorized in ReputationRegistry')

        // ── 3. PrivateLoanPoolV3 ─────────────────────────────────────
        console.log('\n3/5  Deploying PrivateLoanPoolV3...')
        const PoolV3 = await ethers.getContractFactory('PrivateLoanPoolV3')
        const poolV3 = await PoolV3.deploy(deployer.address)
        await poolV3.waitForDeployment()
        const poolAddr = await poolV3.getAddress()
        deployed['PrivateLoanPoolV3'] = poolAddr
        console.log(`  ✓ PrivateLoanPoolV3: ${poolAddr}`)

        // Wire pool → engine and reputation
        await poolV3.setCreditEngine(engineAddr)
        await poolV3.setReputationRegistry(repAddr)
        console.log('  ✓ CreditEngine + ReputationRegistry wired to pool')

        // Authorize pool as integration contract
        await repRegistry.setIntegrationContract(poolAddr)
        console.log('  ✓ Pool authorized in ReputationRegistry')

        // Authorize pool in engine (for cross-contract score access)
        await engineV3.authorizeContract(poolAddr)
        console.log('  ✓ Pool authorized in EncryptedCreditEngineV3')

        // ── 4. CreditDelegationV2 ────────────────────────────────────
        console.log('\n4/5  Deploying CreditDelegationV2...')
        const DelegationV2 = await ethers.getContractFactory('CreditDelegationV2')
        const delegationV2 = await DelegationV2.deploy(deployer.address)
        await delegationV2.waitForDeployment()
        const delegationAddr = await delegationV2.getAddress()
        deployed['CreditDelegationV2'] = delegationAddr
        console.log(`  ✓ CreditDelegationV2: ${delegationAddr}`)

        // Wire delegation → engine and reputation
        await delegationV2.setCreditEngine(engineAddr)
        await delegationV2.setReputationRegistry(repAddr)
        console.log('  ✓ CreditEngine + ReputationRegistry wired to delegation')

        // Authorize delegation as integration contract
        await repRegistry.setIntegrationContract(delegationAddr)
        console.log('  ✓ Delegation authorized in ReputationRegistry')

        // ── 5. CreditDataWithZK (reuse existing) ─────────────────────
        console.log('\n5/5  Deploying CreditDataWithZK...')
        const ZKBridge = await ethers.getContractFactory('CreditDataWithZK')
        const zkBridge = await ZKBridge.deploy(deployer.address)
        await zkBridge.waitForDeployment()
        const zkAddr = await zkBridge.getAddress()
        deployed['CreditDataWithZK'] = zkAddr
        console.log(`  ✓ CreditDataWithZK: ${zkAddr}`)

        await zkBridge.setCreditEngine(engineAddr)
        console.log('  ✓ CreditEngine wired to ZK bridge')

        // ── Save deployment JSON ──────────────────────────────────────
        for (const [name, address] of Object.entries(deployed)) {
            saveDeployment(network.name, name, address)
        }

        // ── Write frontend .env.local automatically ───────────────────
        // Determines chain ID and RPC from the network config
        const chainId = network.config.chainId ?? 84532
        const rpcUrl = (network.config as any).url ?? 'https://sepolia.base.org'
        const blockExplorer = chainId === 84532
            ? 'https://sepolia.basescan.org'
            : chainId === 11155111
            ? 'https://sepolia.etherscan.io'
            : 'https://sepolia.basescan.org'

        const frontendEnvPath = path.join(__dirname, '../frontend/.env.local')
        const frontendEnvContent = `# Auto-generated by deploy-wave3 task on ${new Date().toISOString()}
# Network: ${network.name} (chainId: ${chainId})

# Network
VITE_CHAIN_ID=${chainId}
VITE_RPC_URL=${rpcUrl}
VITE_BLOCK_EXPLORER=${blockExplorer}

# Wave 3 Contracts — deployed ${new Date().toISOString()}
VITE_CREDIT_ENGINE_V3_ADDRESS=${engineAddr}
VITE_LOAN_POOL_V3_ADDRESS=${poolAddr}
VITE_DELEGATION_V2_ADDRESS=${delegationAddr}
VITE_REPUTATION_REGISTRY_ADDRESS=${repAddr}

# Wave 1 Contracts (live on Base Sepolia — kept for reference)
VITE_SIMPLE_CREDIT_ENGINE_ADDRESS=0x749663A4B343846a7C02d14F7d15c72A2643b02B
VITE_LOAN_POOL_ADDRESS=0x0A2AB73CB8311aFD261Ab92137ff70E9Ca268d69
VITE_DELEGATION_ADDRESS=0xA97c943555E92b7E8472118A3b058e72edcDC694
`
        fs.writeFileSync(frontendEnvPath, frontendEnvContent)
        console.log(`\n  ✓ Frontend .env.local written to: ${frontendEnvPath}`)

        // ── Summary ──────────────────────────────────────────────────
        console.log('\n========================================')
        console.log('Wave 3 Deployment Complete!')
        console.log('========================================\n')
        console.log('Contract Addresses:')
        console.log('-'.repeat(55))
        for (const [name, address] of Object.entries(deployed)) {
            console.log(`  ${name.padEnd(30)} ${address}`)
        }
        console.log('-'.repeat(55))
        console.log('\nFrontend env written to: frontend/.env.local')
        console.log('Run: cd frontend && npm run dev\n')
        console.log('\nWave 3 Integration Flow:')
        console.log('  EncryptedCreditEngineV3')
        console.log('    → score expiry (180d), score history, borrowing power')
        console.log('    → cross-contract score sharing via grantScoreAccess()')
        console.log('    → notifies ReputationRegistry on computeCreditScore()')
        console.log('  PrivateLoanPoolV3')
        console.log('    → ebool-gated disbursement — ETH never moves without FHE approval')
        console.log('    → lender yield distribution via claimYield()')
        console.log('    → loan refinancing via refinanceLoan()')
        console.log('    → notifies ReputationRegistry on repayment/default')
        console.log('  CreditDelegationV2')
        console.log('    → yield actually pays out to delegator on repayBond()')
        console.log('    → bond expiry + markExpiredDefault()')
        console.log('    → credit score check on acceptOffer()')
        console.log('    → notifies ReputationRegistry on repayment/default')
        console.log('  ReputationRegistry')
        console.log('    → notifyActivity() called by all three contracts')
        console.log('    → composite score updates automatically\n')

        return deployed
    })
