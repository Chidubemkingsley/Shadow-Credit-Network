import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment, getDeployment } from './utils'

task('deploy-zk-verifier', 'Deploy the Groth16Verifier and CreditDataWithZK contracts')
	.addOptionalParam('creditEngine', 'Address of EncryptedCreditEngine')
	.setAction(async (args, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		console.log(`\nDeploying ZKVerifier contracts to ${network.name}...`)

		const [deployer] = await ethers.getSigners()
		console.log(`Deployer: ${deployer.address}`)
		console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)

		// Deploy Groth16Verifier
		console.log('\n1. Deploying Groth16Verifier...')
		const Groth16Verifier = await ethers.getContractFactory('Groth16Verifier')
		const verifier = await Groth16Verifier.deploy()
		await verifier.waitForDeployment()
		const verifierAddress = await verifier.getAddress()
		console.log(`   Groth16Verifier deployed to: ${verifierAddress}`)

		// Deploy CreditDataWithZK
		console.log('\n2. Deploying CreditDataWithZK...')
		const CreditDataWithZK = await ethers.getContractFactory('CreditDataWithZK')
		const zkBridge = await CreditDataWithZK.deploy(deployer.address)
		await zkBridge.waitForDeployment()
		const bridgeAddress = await zkBridge.getAddress()
		console.log(`   CreditDataWithZK deployed to: ${bridgeAddress}`)

		// Configure bridge
		console.log('\n3. Configuring bridge...')
		await zkBridge.setVerifier(verifierAddress)
		console.log('   Verifier set')

		const creditEngineAddress = args.creditEngine || getDeployment(network.name, 'EncryptedCreditEngine')
		if (creditEngineAddress) {
			await zkBridge.setCreditEngine(creditEngineAddress)
			console.log(`   Credit engine set: ${creditEngineAddress}`)
		}

		// Save deployments
		saveDeployment(network.name, 'Groth16Verifier', verifierAddress)
		saveDeployment(network.name, 'CreditDataWithZK', bridgeAddress)

		// Verify contracts
		if (network.name !== 'hardhat' && network.name !== 'localcofhe') {
			console.log('\n4. Verifying contracts...')
			for (const [name, address, args] of [
				['Groth16Verifier', verifierAddress, []],
				['CreditDataWithZK', bridgeAddress, [deployer.address]],
			] as const) {
				try {
					await hre.run('verify:verify', { address, constructorArguments: args })
					console.log(`   ${name} verified`)
				} catch (error: any) {
					if (error.message.includes('Already Verified')) {
						console.log(`   ${name} already verified`)
					} else {
						console.log(`   ${name} verification failed: ${error.message}`)
					}
				}
			}
		}

		console.log(`\nDeployment complete!`)
		console.log(`Groth16Verifier:    ${verifierAddress}`)
		console.log(`CreditDataWithZK:   ${bridgeAddress}`)

		return { verifier: verifierAddress, bridge: bridgeAddress }
	})
