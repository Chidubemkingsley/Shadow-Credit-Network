import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment, getDeployment } from './utils'

task('deploy-reputation-registry', 'Deploy the ReputationRegistry contract')
	.addOptionalParam('creditEngine', 'Address of EncryptedCreditEngine to register as integration')
	.addOptionalParam('decayInterval', 'Decay interval in seconds (default: 90 days)')
	.addOptionalParam('minAttestations', 'Minimum attestations required (default: 2)')
	.setAction(async (args, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		console.log(`\nDeploying ReputationRegistry to ${network.name}...`)

		const [deployer] = await ethers.getSigners()
		console.log(`Deployer: ${deployer.address}`)
		console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)

		const decayInterval = args.decayInterval || 90 * 24 * 60 * 60 // 90 days
		const minAttestations = args.minAttestations || 2

		console.log(`Owner: ${deployer.address}`)
		console.log(`Decay interval: ${decayInterval}s (${decayInterval / 86400} days)`)
		console.log(`Min attestations: ${minAttestations}`)

		const ReputationRegistry = await ethers.getContractFactory('ReputationRegistry')
		const registry = await ReputationRegistry.deploy(
			deployer.address,
			decayInterval,
			minAttestations
		)
		await registry.waitForDeployment()

		const address = await registry.getAddress()
		console.log(`ReputationRegistry deployed to: ${address}`)

		// If credit engine address provided, register it as integration contract
		const creditEngineAddress = args.creditEngine || getDeployment(network.name, 'EncryptedCreditEngine')
		if (creditEngineAddress) {
			console.log(`\nRegistering EncryptedCreditEngine (${creditEngineAddress}) as integration contract...`)
			const tx = await registry.setIntegrationContract(creditEngineAddress)
			await tx.wait()
			console.log('Integration contract registered')
		}

		// Verify contract on block explorer
		if (network.name !== 'hardhat' && network.name !== 'localcofhe') {
			console.log('\nWaiting for block confirmations...')
			const deployTx = registry.deploymentTransaction()
			if (deployTx) {
				await deployTx.wait(5)
			}

			console.log('Verifying contract on block explorer...')
			try {
				await hre.run('verify:verify', {
					address: address,
					constructorArguments: [deployer.address, decayInterval, minAttestations],
				})
				console.log('Contract verified successfully')
			} catch (error: any) {
				if (error.message.includes('Already Verified')) {
					console.log('Contract already verified')
				} else {
					console.log(`Verification failed: ${error.message}`)
				}
			}
		}

		saveDeployment(network.name, 'ReputationRegistry', address)

		console.log(`\nDeployment complete!`)
		console.log(`Network: ${network.name}`)
		console.log(`Contract: ${address}`)

		return address
	})
