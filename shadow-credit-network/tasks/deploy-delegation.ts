import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'

task('deploy-delegation', 'Deploy the CreditDelegation contract')
	.setAction(async (args, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		console.log(`\nDeploying CreditDelegation to ${network.name}...`)

		const [deployer] = await ethers.getSigners()
		console.log(`Deployer: ${deployer.address}`)
		console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)

		const CreditDelegation = await ethers.getContractFactory('CreditDelegation')
		const delegation = await CreditDelegation.deploy(deployer.address)
		await delegation.waitForDeployment()

		const address = await delegation.getAddress()
		console.log(`CreditDelegation deployed to: ${address}`)

		// Save deployment
		saveDeployment(network.name, 'CreditDelegation', address)

		console.log(`\nDeployment complete!`)
		console.log(`Network: ${network.name}`)
		console.log(`Contract: ${address}`)

		return address
	})
