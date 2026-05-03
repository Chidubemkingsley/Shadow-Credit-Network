import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'

interface DeployAllArgs {
	feeReceiver?: string
	skipVerification?: boolean
}

task('deploy-all', 'Deploy full Shadow Credit Network stack with proper wiring')
	.addOptionalParam('feeReceiver', 'Fee receiver address (defaults to deployer)')
	.addFlag('skipVerification', 'Skip block explorer verification')
	.setAction(async (args: DeployAllArgs, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		console.log('\n========================================')
		console.log('Shadow Credit Network - Full Deployment')
		console.log('========================================\n')

		const [deployer] = await ethers.getSigners()
		console.log(`Deployer: ${deployer.address}`)
		console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)
		console.log(`Network: ${network.name}\n`)

		const feeReceiver = args.feeReceiver || deployer.address
		const isLocalNetwork = network.name === 'hardhat' || network.name === 'localcofhe'

		const deployed: Record<string, string> = {}

		// ============================================
		// Step 1: Deploy EncryptedCreditEngine
		// ============================================
		console.log('Step 1/6: Deploying EncryptedCreditEngine...')
		const EncryptedCreditEngine = await ethers.getContractFactory('EncryptedCreditEngine')
		const creditEngine = await EncryptedCreditEngine.deploy(feeReceiver)
		await creditEngine.waitForDeployment()
		const creditEngineAddress = await creditEngine.getAddress()
		deployed['EncryptedCreditEngine'] = creditEngineAddress
		console.log(`  ✓ EncryptedCreditEngine: ${creditEngineAddress}`)

		// ============================================
		// Step 2: Deploy Groth16Verifier
		// ============================================
		console.log('\nStep 2/6: Deploying Groth16Verifier...')
		const Groth16Verifier = await ethers.getContractFactory('contracts/Groth16Verifier.sol:Groth16Verifier')
		const groth16Verifier = await Groth16Verifier.deploy()
		await groth16Verifier.waitForDeployment()
		const verifierAddress = await groth16Verifier.getAddress()
		deployed['Groth16Verifier'] = verifierAddress
		console.log(`  ✓ Groth16Verifier: ${verifierAddress}`)

		// ============================================
		// Step 3: Deploy CreditDataWithZK (links verifier + engine)
		// ============================================
		console.log('\nStep 3/6: Deploying CreditDataWithZK...')
		const CreditDataWithZK = await ethers.getContractFactory('CreditDataWithZK')
		const creditDataWithZK = await CreditDataWithZK.deploy(deployer.address)
		await creditDataWithZK.waitForDeployment()
		const zkBridgeAddress = await creditDataWithZK.getAddress()
		deployed['CreditDataWithZK'] = zkBridgeAddress
		console.log(`  ✓ CreditDataWithZK: ${zkBridgeAddress}`)

		// Wire CreditDataWithZK to Groth16Verifier and EncryptedCreditEngine
		console.log('\n  Wiring CreditDataWithZK...')
		await creditDataWithZK.setVerifier(verifierAddress)
		console.log('    ✓ Verifier set')
		await creditDataWithZK.setCreditEngine(creditEngineAddress)
		console.log('    ✓ Credit engine set')

		// ============================================
		// Step 4: Deploy PrivateLoanPool (links to credit engine)
		// ============================================
		console.log('\nStep 4/6: Deploying PrivateLoanPool...')
		const PrivateLoanPool = await ethers.getContractFactory('PrivateLoanPool')
		const loanPool = await PrivateLoanPool.deploy(deployer.address)
		await loanPool.waitForDeployment()
		const loanPoolAddress = await loanPool.getAddress()
		deployed['PrivateLoanPool'] = loanPoolAddress
		console.log(`  ✓ PrivateLoanPool: ${loanPoolAddress}`)

		// Wire PrivateLoanPool to EncryptedCreditEngine
		console.log('\n  Wiring PrivateLoanPool to EncryptedCreditEngine...')
		await loanPool.setCreditEngine(creditEngineAddress)
		console.log('    ✓ Credit engine linked')

		// ============================================
		// Step 5: Deploy CreditDelegation
		// ============================================
		console.log('\nStep 5/6: Deploying CreditDelegation...')
		const CreditDelegation = await ethers.getContractFactory('CreditDelegation')
		const creditDelegation = await CreditDelegation.deploy(deployer.address, feeReceiver)
		await creditDelegation.waitForDeployment()
		const delegationAddress = await creditDelegation.getAddress()
		deployed['CreditDelegation'] = delegationAddress
		console.log(`  ✓ CreditDelegation: ${delegationAddress}`)

		// Wire CreditDelegation
		console.log('\n  Wiring CreditDelegation...')
		await creditDelegation.setCreditEngine(creditEngineAddress)
		console.log('    ✓ Credit engine linked')

		// ============================================
		// Step 6: Deploy ReputationRegistry
		// ============================================
		console.log('\nStep 6/6: Deploying ReputationRegistry...')
		const ReputationRegistry = await ethers.getContractFactory('ReputationRegistry')
		const reputationRegistry = await ReputationRegistry.deploy(
			deployer.address,
			90 * 24 * 60 * 60, // decayInterval: 90 days in seconds
			2                    // minAttestations
		)
		await reputationRegistry.waitForDeployment()
		const reputationAddress = await reputationRegistry.getAddress()
		deployed['ReputationRegistry'] = reputationAddress
		console.log(`  ✓ ReputationRegistry: ${reputationAddress}`)

		// Wire ReputationRegistry to EncryptedCreditEngine
		console.log('\n  Wiring ReputationRegistry...')
		await reputationRegistry.setIntegrationContract(creditEngineAddress)
		console.log('    ✓ Integration contract linked')

		// ============================================
		// Save deployment addresses
		// ============================================
		console.log('\n========================================')
		console.log('Saving deployment addresses...')
		console.log('========================================')

		for (const [name, address] of Object.entries(deployed)) {
			saveDeployment(network.name, name, address)
		}

		// ============================================
		// Verification (if not local network)
		// ============================================
		if (!isLocalNetwork && !args.skipVerification) {
			console.log('\n========================================')
			console.log('Verifying contracts on block explorer...')
			console.log('========================================')

			const verificationDelay = 30000
			console.log(`\nWaiting ${verificationDelay / 1000}s for explorer to index...`)
			await new Promise(resolve => setTimeout(resolve, verificationDelay))

			try {
				console.log('\nVerifying EncryptedCreditEngine...')
				await hre.run('verify:verify', {
					address: creditEngineAddress,
					constructorArguments: [feeReceiver],
				})
				console.log('  ✓ Verified')
			} catch (e: any) {
				console.log(`  ! ${e.message?.includes('Already Verified') ? 'Already verified' : 'Verification failed'}`)
			}

			try {
				console.log('\nVerifying Groth16Verifier...')
				await hre.run('verify:verify', {
					address: verifierAddress,
				})
				console.log('  ✓ Verified')
			} catch (e: any) {
				console.log(`  ! ${e.message?.includes('Already Verified') ? 'Already verified' : 'Verification failed'}`)
			}

			try {
				console.log('\nVerifying CreditDataWithZK...')
				await hre.run('verify:verify', {
					address: zkBridgeAddress,
					constructorArguments: [deployer.address],
				})
				console.log('  ✓ Verified')
			} catch (e: any) {
				console.log(`  ! ${e.message?.includes('Already Verified') ? 'Already verified' : 'Verification failed'}`)
			}

			try {
				console.log('\nVerifying PrivateLoanPool...')
				await hre.run('verify:verify', {
					address: loanPoolAddress,
					constructorArguments: [deployer.address, feeReceiver],
				})
				console.log('  ✓ Verified')
			} catch (e: any) {
				console.log(`  ! ${e.message?.includes('Already Verified') ? 'Already verified' : 'Verification failed'}`)
			}

			try {
				console.log('\nVerifying CreditDelegation...')
				await hre.run('verify:verify', {
					address: delegationAddress,
					constructorArguments: [deployer.address, feeReceiver],
				})
				console.log('  ✓ Verified')
			} catch (e: any) {
				console.log(`  ! ${e.message?.includes('Already Verified') ? 'Already verified' : 'Verification failed'}`)
			}

			try {
				console.log('\nVerifying ReputationRegistry...')
				await hre.run('verify:verify', {
					address: reputationAddress,
					constructorArguments: [creditEngineAddress, deployer.address],
				})
				console.log('  ✓ Verified')
			} catch (e: any) {
				console.log(`  ! ${e.message?.includes('Already Verified') ? 'Already verified' : 'Verification failed'}`)
			}
		}

		// ============================================
		// Summary
		// ============================================
		console.log('\n========================================')
		console.log('Deployment Complete!')
		console.log('========================================\n')
		console.log('Contract Addresses:')
		console.log('-'.repeat(50))
		for (const [name, address] of Object.entries(deployed)) {
			console.log(`  ${name.padEnd(25)} ${address}`)
		}
		console.log('-'.repeat(50))
		console.log('\nIntegration Flow:')
		console.log('  CreditDataWithZK → Groth16Verifier (ZK proofs)')
		console.log('                ↘ EncryptedCreditEngine (credit scores)')
		console.log('  PrivateLoanPool → EncryptedCreditEngine (score verification)')
		console.log('  CreditDelegation → EncryptedCreditEngine')
		console.log('  ReputationRegistry → EncryptedCreditEngine\n')

		return deployed
	})
