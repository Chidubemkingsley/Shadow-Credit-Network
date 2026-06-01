import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'
import fs from 'fs'
import path from 'path'

task('deploy-wave5', 'Deploy full Shadow Credit stack to Arbitrum Sepolia (Waves 1-5)')
    .addOptionalParam('skipVerification', 'Skip block explorer verification')
    .setAction(async (args: any, hre: HardhatRuntimeEnvironment) => {
        const { ethers, network } = hre

        console.log('\n========================================')
        console.log('Shadow Credit Network — Wave 5 Deployment')
        console.log('(Full stack: Waves 1–5 on Arbitrum Sepolia)')
        console.log('========================================\n')

        const [deployer] = await ethers.getSigners()
        console.log(`Deployer:  ${deployer.address}`)
        console.log(`Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)
        console.log(`Network:   ${network.name} (chainId: ${network.config.chainId})\n`)

        const deployed: Record<string, string> = {}

        // ═══════════════════════════════════════════════════════════════
        // Wave 3 — Core Protocol Stack
        // ═══════════════════════════════════════════════════════════════

        // ── 1. ReputationRegistry ──────────────────────────────────────
        console.log('1/9  Deploying ReputationRegistry...')
        const ReputationRegistry = await ethers.getContractFactory('ReputationRegistry')
        const repRegistry = await ReputationRegistry.deploy(
            deployer.address,
            90 * 24 * 60 * 60,
            2
        )
        await repRegistry.waitForDeployment()
        const repAddr = await repRegistry.getAddress()
        deployed['ReputationRegistry'] = repAddr
        console.log(`  ✓ ReputationRegistry: ${repAddr}`)

        // ── 2. EncryptedCreditEngineV3 ────────────────────────────────
        console.log('\n2/9  Deploying EncryptedCreditEngineV3...')
        const EngineV3 = await ethers.getContractFactory('EncryptedCreditEngineV3')
        const engineV3 = await EngineV3.deploy(deployer.address)
        await engineV3.waitForDeployment()
        const engineAddr = await engineV3.getAddress()
        deployed['EncryptedCreditEngineV3'] = engineAddr
        console.log(`  ✓ EncryptedCreditEngineV3: ${engineAddr}`)

        console.log('  Wiring ReputationRegistry → Engine...')
        await engineV3.setReputationRegistry(repAddr)
        await repRegistry.setIntegrationContract(engineAddr)
        console.log('  ✓ Reputation wired to engine')

        // ── 3. PrivateLoanPoolV3 ──────────────────────────────────────
        console.log('\n3/9  Deploying PrivateLoanPoolV3...')
        const PoolV3 = await ethers.getContractFactory('PrivateLoanPoolV3')
        const poolV3 = await PoolV3.deploy(deployer.address)
        await poolV3.waitForDeployment()
        const poolAddr = await poolV3.getAddress()
        deployed['PrivateLoanPoolV3'] = poolAddr
        console.log(`  ✓ PrivateLoanPoolV3: ${poolAddr}`)

        console.log('  Wiring Pool → Engine + Reputation...')
        await poolV3.setCreditEngine(engineAddr)
        await poolV3.setReputationRegistry(repAddr)
        await repRegistry.setIntegrationContract(poolAddr)
        await engineV3.authorizeContract(poolAddr)
        console.log('  ✓ Pool wired')

        // ── 4. CreditDelegationV2 ─────────────────────────────────────
        console.log('\n4/9  Deploying CreditDelegationV2...')
        const DelegationV2 = await ethers.getContractFactory('CreditDelegationV2')
        const delegationV2 = await DelegationV2.deploy(deployer.address)
        await delegationV2.waitForDeployment()
        const delegationAddr = await delegationV2.getAddress()
        deployed['CreditDelegationV2'] = delegationAddr
        console.log(`  ✓ CreditDelegationV2: ${delegationAddr}`)

        console.log('  Wiring Delegation → Engine + Reputation...')
        await delegationV2.setCreditEngine(engineAddr)
        await delegationV2.setReputationRegistry(repAddr)
        await repRegistry.setIntegrationContract(delegationAddr)
        console.log('  ✓ Delegation wired')

        // ── 5. CreditDataWithZK ───────────────────────────────────────
        console.log('\n5/9  Deploying CreditDataWithZK...')
        const ZKBridge = await ethers.getContractFactory('CreditDataWithZK')
        const zkBridge = await ZKBridge.deploy(deployer.address)
        await zkBridge.waitForDeployment()
        const zkAddr = await zkBridge.getAddress()
        deployed['CreditDataWithZK'] = zkAddr
        console.log(`  ✓ CreditDataWithZK: ${zkAddr}`)

        console.log('  Wiring ZK Bridge → Engine...')
        await zkBridge.setCreditEngine(engineAddr)
        console.log('  ✓ ZK Bridge wired')

        // ═══════════════════════════════════════════════════════════════
        // Wave 4 — Identity & Governance
        // ═══════════════════════════════════════════════════════════════

        // ── 6. ScoreGatedGovernance ────────────────────────────────────
        console.log('\n6/9  Deploying ScoreGatedGovernance...')
        const Governance = await ethers.getContractFactory('ScoreGatedGovernance')
        const governance = await Governance.deploy(deployer.address, engineAddr, poolAddr)
        await governance.waitForDeployment()
        const govAddr = await governance.getAddress()
        deployed['ScoreGatedGovernance'] = govAddr
        console.log(`  ✓ ScoreGatedGovernance: ${govAddr}`)

        // ── 7. SoulboundCreditNFT ──────────────────────────────────────
        console.log('\n7/9  Deploying SoulboundCreditNFT...')
        const SoulboundNFT = await ethers.getContractFactory('SoulboundCreditNFT')
        const nft = await SoulboundNFT.deploy(deployer.address, engineAddr)
        await nft.waitForDeployment()
        const nftAddr = await nft.getAddress()
        deployed['SoulboundCreditNFT'] = nftAddr
        console.log(`  ✓ SoulboundCreditNFT: ${nftAddr}`)

        // ═══════════════════════════════════════════════════════════════
        // Wave 5 — Expansion Contracts
        // ═══════════════════════════════════════════════════════════════

        // ── 8. MultiAssetLoanPool ──────────────────────────────────────
        console.log('\n8/9  Deploying MultiAssetLoanPool...')
        const MultiAssetPool = await ethers.getContractFactory('MultiAssetLoanPool')
        const multiPool = await MultiAssetPool.deploy(deployer.address)
        await multiPool.waitForDeployment()
        const multiPoolAddr = await multiPool.getAddress()
        deployed['MultiAssetLoanPool'] = multiPoolAddr
        console.log(`  ✓ MultiAssetLoanPool: ${multiPoolAddr}`)

        console.log('  Wiring MultiAssetLoanPool → Engine + Reputation...')
        await multiPool.setCreditEngine(engineAddr)
        await multiPool.setReputationRegistry(repAddr)
        console.log('  ✓ MultiAssetLoanPool wired')

        // ── 9. CrossChainCreditBridge ─────────────────────────────────
        console.log('\n9/9  Deploying CrossChainCreditBridge...')
        const LZ_ENDPOINT_ARB_SEPOLIA = '0x6EDCE65403992e310A62460808c4b910D972f10f'
        const LZ_EID_ARB_SEPOLIA = 40231
        const Bridge = await ethers.getContractFactory('CrossChainCreditBridge')
        const bridge = await Bridge.deploy(
            deployer.address,
            LZ_ENDPOINT_ARB_SEPOLIA,
            engineAddr,
            LZ_EID_ARB_SEPOLIA
        )
        await bridge.waitForDeployment()
        const bridgeAddr = await bridge.getAddress()
        deployed['CrossChainCreditBridge'] = bridgeAddr
        console.log(`  ✓ CrossChainCreditBridge: ${bridgeAddr}`)

        // ── Save deployment JSON ───────────────────────────────────────
        for (const [name, address] of Object.entries(deployed)) {
            saveDeployment(network.name, name, address)
        }

        // ── Write frontend .env.local ──────────────────────────────────
        const chainId = network.config.chainId ?? 421614
        const rpcUrl = 'https://sepolia-rollup.arbitrum.io/rpc'
        const blockExplorer = 'https://sepolia.arbiscan.io'

        const frontendEnvPath = path.join(__dirname, '../frontend/.env.local')
        const frontendEnvContent = `# Auto-generated by deploy-wave5 task on ${new Date().toISOString()}
# Network: ${network.name} (chainId: ${chainId})
# CoFHE is LIVE on Arbitrum Sepolia — all FHE operations work.

# Network
VITE_CHAIN_ID=${chainId}
VITE_RPC_URL=${rpcUrl}
VITE_BLOCK_EXPLORER=${blockExplorer}

# Wave 3 Contracts — deployed ${new Date().toISOString()}
VITE_CREDIT_ENGINE_V3_ADDRESS=${engineAddr}
VITE_LOAN_POOL_V3_ADDRESS=${poolAddr}
VITE_DELEGATION_V2_ADDRESS=${delegationAddr}
VITE_REPUTATION_REGISTRY_ADDRESS=${repAddr}
VITE_CREDIT_DATA_WITH_ZK_ADDRESS=${zkAddr}

# Wave 4 Contracts
VITE_GOVERNANCE_ADDRESS=${govAddr}
VITE_CREDIT_NFT_ADDRESS=${nftAddr}

# Wave 5 Contracts
VITE_MULTI_ASSET_LOAN_POOL_ADDRESS=${multiPoolAddr}
VITE_CROSS_CHAIN_CREDIT_BRIDGE_ADDRESS=${bridgeAddr}
`
        fs.writeFileSync(frontendEnvPath, frontendEnvContent)
        console.log(`\n  ✓ Frontend .env.local written to: ${frontendEnvPath}`)

        // ── Verify on block explorer ───────────────────────────────────
        if (!args.skipVerification && network.name !== 'localcofhe' && network.name !== 'hardhat') {
            console.log('\nVerifying contracts on block explorer...')
            const contractsToVerify: { name: string; addr: string; args: any[] }[] = [
                { name: 'ReputationRegistry',           addr: repAddr,      args: [deployer.address, 90 * 24 * 60 * 60, 2] },
                { name: 'EncryptedCreditEngineV3',      addr: engineAddr,   args: [deployer.address] },
                { name: 'PrivateLoanPoolV3',            addr: poolAddr,     args: [deployer.address] },
                { name: 'CreditDelegationV2',           addr: delegationAddr, args: [deployer.address] },
                { name: 'CreditDataWithZK',             addr: zkAddr,       args: [deployer.address] },
                { name: 'ScoreGatedGovernance',         addr: govAddr,      args: [deployer.address, engineAddr, poolAddr] },
                { name: 'SoulboundCreditNFT',           addr: nftAddr,      args: [deployer.address, engineAddr] },
                { name: 'MultiAssetLoanPool',           addr: multiPoolAddr, args: [deployer.address] },
                { name: 'CrossChainCreditBridge',       addr: bridgeAddr,   args: [deployer.address, LZ_ENDPOINT_ARB_SEPOLIA, engineAddr, LZ_EID_ARB_SEPOLIA] },
            ]
            for (const c of contractsToVerify) {
                try {
                    console.log(`  Verifying ${c.name}...`)
                    await hre.run('verify:verify', { address: c.addr, constructorArguments: c.args })
                    console.log(`    ✓ ${c.name} verified`)
                } catch (e: any) {
                    console.log(`    ⚠  ${e.message?.includes('Already Verified') ? 'Already verified' : e.message?.slice(0, 80)}`)
                }
            }
        }

        // ── Summary ────────────────────────────────────────────────────
        console.log('\n========================================')
        console.log('Wave 5 Deployment Complete!')
        console.log(`Network: ${network.name} (chainId: ${chainId})`)
        console.log('========================================\n')
        console.log('Contract Addresses:')
        console.log('-'.repeat(60))
        for (const [name, address] of Object.entries(deployed)) {
            console.log(`  ${name.padEnd(32)} ${address}`)
        }
        console.log('-'.repeat(60))
        console.log('\nCoFHE features now available on Arbitrum Sepolia:')
        console.log('  → submitCreditData() with real InEuint* ciphertexts')
        console.log('  → requestScoreDecryption() — network-gated decrypt')
        console.log('  → requestLoan() V3 — ebool-gated FHE loan approval')
        console.log('  → requestDecryption() — reputation composite score')
        console.log('  → SoulboundCreditNFT — tier from decrypted score')
        console.log('  → ScoreGatedGovernance — vote with credit tier')
        console.log('  → MultiAssetLoanPool — ERC-20 collateral lending')
        console.log('  → CrossChainCreditBridge — LayerZero score portability\n')
        console.log('Run: cd frontend && npm run dev\n')

        return deployed
    })
