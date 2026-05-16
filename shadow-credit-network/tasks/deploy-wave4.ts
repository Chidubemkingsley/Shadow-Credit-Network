import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'
import fs from 'fs'
import path from 'path'

task('deploy-wave4', 'Deploy Wave 4 Shadow Credit Network stack (SoulboundCreditNFT)')
    .addOptionalParam('creditEngine', 'Address of EncryptedCreditEngineV3 (defaults to env var)')
    .addOptionalParam('skipVerification', 'Skip block explorer verification')
    .setAction(async (args: any, hre: HardhatRuntimeEnvironment) => {
        const { ethers, network } = hre

        console.log('\n========================================')
        console.log('Shadow Credit Network — Wave 4 Deployment')
        console.log('========================================\n')

        const [deployer] = await ethers.getSigners()
        console.log(`Deployer:  ${deployer.address}`)
        console.log(`Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)
        console.log(`Network:   ${network.name}\n`)

        // Resolve the credit engine address
        const engineAddr = args.creditEngine
            || process.env.VITE_CREDIT_ENGINE_V3_ADDRESS
            || ethers.ZeroAddress

        if (engineAddr === ethers.ZeroAddress) {
            console.warn('  ⚠  No credit engine address provided.')
            console.warn('     Deploy Wave 3 first, or pass --credit-engine <addr>')
            console.warn('     Deploying SoulboundCreditNFT without credit engine (can be set later).\n')
        } else {
            console.log(`  Credit engine: ${engineAddr}`)
        }

        const deployed: Record<string, string> = {}

        // ── 1. SoulboundCreditNFT ──────────────────────────────────────
        console.log('\n1/1  Deploying SoulboundCreditNFT...')
        const SoulboundNFT = await ethers.getContractFactory('SoulboundCreditNFT')
        const nft = await SoulboundNFT.deploy(deployer.address, engineAddr)
        await nft.waitForDeployment()
        const nftAddr = await nft.getAddress()
        deployed['SoulboundCreditNFT'] = nftAddr
        console.log(`  ✓ SoulboundCreditNFT: ${nftAddr}`)

        // ── Save deployment JSON ───────────────────────────────────────
        for (const [name, address] of Object.entries(deployed)) {
            saveDeployment(network.name, name, address)
        }

        // ── Append to existing frontend .env.local ────────────────────
        const frontendEnvPath = path.join(__dirname, '../frontend/.env.local')
        const wave4Env = `\n# Wave 4 Contracts — deployed ${new Date().toISOString()}\nVITE_SOULBOUND_NFT_ADDRESS=${nftAddr}\n`

        if (fs.existsSync(frontendEnvPath)) {
            fs.appendFileSync(frontendEnvPath, wave4Env)
            console.log(`\n  ✓ VITE_SOULBOUND_NFT_ADDRESS appended to frontend/.env.local`)
        } else {
            fs.writeFileSync(frontendEnvPath, wave4Env)
            console.log(`\n  ✓ frontend/.env.local created with Wave 4 addresses`)
        }

        // ── Summary ────────────────────────────────────────────────────
        console.log('\n========================================')
        console.log('Wave 4 Deployment Complete!')
        console.log('========================================\n')
        console.log('Contract Addresses:')
        console.log('-'.repeat(55))
        for (const [name, address] of Object.entries(deployed)) {
            console.log(`  ${name.padEnd(30)} ${address}`)
        }
        console.log('-'.repeat(55))
        console.log('\nWave 4 — SoulboundCreditNFT:')
        console.log('  Soulbound ERC-721 — one per address, non-transferable')
        console.log('  mint()         — requires register() + computeCreditScore() in engine')
        console.log('  refreshTier()  — updates tier from latest decrypted score')
        console.log('  burn()         — holder can exit and re-mint later')
        console.log('  tokenURI()     — on-chain SVG, no IPFS dependency')
        console.log('  Tiers: Prime (740+), NearPrime (670+), Subprime (580+), DeepSubprime')
        console.log('\nNext: run cast call <nft-addr> "totalMinted()(uint256)" to verify\n')

        // ── Verify on block explorer ────────────────────────────────────
        if (!args.skipVerification && network.name !== 'localcofhe' && network.name !== 'hardhat') {
            console.log('\nVerifying on block explorer...')
            try {
                await hre.run('verify:verify', {
                    address: nftAddr,
                    constructorArguments: [deployer.address, engineAddr],
                })
                console.log('  ✓ Verified')
            } catch (e: any) {
                console.warn(`  ⚠  Verification failed: ${e.message}`)
            }
        }

        return deployed
    })
