import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment, getDeployment } from './utils'

task('deploy-credit-delegation', 'Deploy the CreditDelegation contract')
	.addOptionalParam('feeReceiver', 'Fee receiver address (defaults to deployer)')
	.addOptionalParam('creditEngine', 'Address of EncryptedCreditEngine')
	.setAction(async (args, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		console.log(`\nDeploying CreditDelegation to ${network.name}...`)

		const [deployer] = await ethers.getSigners()
		console.log(`Deployer: ${deployer.address}`)
		console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)

		const feeReceiver = args.feeReceiver || deployer.address
		console.log(`Fee receiver: ${feeReceiver}`)

		const CreditDelegation = await ethers.getContractFactory('CreditDelegation')
		const delegation = await CreditDelegation.deploy(deployer.address, feeReceiver)
		await delegation.waitForDeployment()

		const address = await delegation.getAddress()
		console.log(`CreditDelegation deployed to: ${address}`)

		const creditEngineAddress = args.creditEngine || getDeployment(network.name, 'EncryptedCreditEngine')
		if (creditEngineAddress) {
			console.log(`\nSetting credit engine: ${creditEngineAddress}`)
			const tx = await delegation.setCreditEngine(creditEngineAddress)
			await tx.wait()
			console.log('Credit engine set')
		}

		if (network.name !== 'hardhat' && network.name !== 'localcofhe') {
			console.log('\nWaiting for block confirmations...')
			const deployTx = delegation.deploymentTransaction()
			if (deployTx) await deployTx.wait(5)

			console.log('Verifying contract on block explorer...')
			try {
				await hre.run('verify:verify', {
					address: address,
					constructorArguments: [deployer.address, feeReceiver],
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

		saveDeployment(network.name, 'CreditDelegation', address)

		console.log(`\nDeployment complete!`)
		console.log(`Network: ${network.name}`)
		console.log(`Contract: ${address}`)

		return address
	})
