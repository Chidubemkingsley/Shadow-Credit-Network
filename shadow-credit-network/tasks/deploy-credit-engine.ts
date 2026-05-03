import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'

task('deploy-credit-engine', 'Deploy the EncryptedCreditEngine contract')
	.addOptionalParam('feeReceiver', 'Fee receiver address (defaults to deployer)')
	.setAction(async (args, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		console.log(`\nDeploying EncryptedCreditEngine to ${network.name}...`)

		const [deployer] = await ethers.getSigners()
		console.log(`Deployer: ${deployer.address}`)
		console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)

		const feeReceiver = args.feeReceiver || deployer.address
		console.log(`Fee receiver: ${feeReceiver}`)

		const EncryptedCreditEngine = await ethers.getContractFactory('EncryptedCreditEngine')
		const engine = await EncryptedCreditEngine.deploy(feeReceiver)
		await engine.waitForDeployment()

		const address = await engine.getAddress()
		console.log(`EncryptedCreditEngine deployed to: ${address}`)

		// Verify contract on block explorer (if API key available)
		if (network.name !== 'hardhat' && network.name !== 'localcofhe') {
			console.log('\nWaiting for block confirmations...')
			const deployTx = engine.deploymentTransaction()
			if (deployTx) {
				await deployTx.wait(5)
			}

			console.log('Verifying contract on block explorer...')
			try {
				await hre.run('verify:verify', {
					address: address,
					constructorArguments: [feeReceiver],
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

		saveDeployment(network.name, 'EncryptedCreditEngine', address)

		console.log(`\nDeployment complete!`)
		console.log(`Network: ${network.name}`)
		console.log(`Contract: ${address}`)
		console.log(`Fee Receiver: ${feeReceiver}`)

		return address
	})
