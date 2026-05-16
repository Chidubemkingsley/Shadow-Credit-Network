import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { expect } from 'chai'

describe('PrivateLoanPoolV3', function () {
	async function deployPoolFixture() {
		const [owner, alice, bob] = await hre.ethers.getSigners()

		const Engine = await hre.ethers.getContractFactory('EncryptedCreditEngineV3')
		const engine = await Engine.deploy(owner.address)

		const ReputationRegistry = await hre.ethers.getContractFactory('ReputationRegistry')
		const registry = await ReputationRegistry.deploy(owner.address, 90 * 86400, 2)
		await engine.connect(owner).setReputationRegistry(await registry.getAddress())
		await registry.connect(owner).setIntegrationContract(await engine.getAddress())

		const PrivateLoanPool = await hre.ethers.getContractFactory('PrivateLoanPoolV3')
		const pool = await PrivateLoanPool.deploy(owner.address)

		await registry.connect(owner).setIntegrationContract(await pool.getAddress())
		await pool.connect(owner).setReputationRegistry(await registry.getAddress())

		await pool.connect(owner).fundPool({ value: hre.ethers.parseEther('100') })

		return { pool, engine, registry, owner, alice, bob }
	}

	beforeEach(function () {
		if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
	})

	describe('Core Flow & Reputation', function () {
		it('Should notify activity on borrow and repay', async function () {
			const { pool, engine, registry, owner, alice } = await loadFixture(deployPoolFixture)
			
			await registry.connect(alice).register()
			await engine.connect(alice).register()

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))
			const [encIncome] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(200_000n)] as const))
			const [encDebt] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(10_000n)] as const))
			const [encPaymentHistory] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(9500n)] as const))
			const [encUtilization] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(3000n)] as const))
			const [encAccountAge] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(1825n)] as const))
			const [encDefaults] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(0n)] as const))

			await engine.connect(alice).submitCreditData(encIncome, encDebt, encPaymentHistory, encUtilization, encAccountAge, encDefaults)
			await engine.connect(alice).computeCreditScore()
			await engine.connect(alice).computeBorrowingPower()

			// Borrow request
			const amount = hre.ethers.parseEther('5').valueOf()
			const duration = 30 * 86400
			
			await pool.connect(alice).requestLoan(amount, duration, 1)

			// Mine a block to allow mock async decryption to complete
			await hre.network.provider.send("evm_mine", [])

			// Loan is auto-approved when credit engine is not set
			
			const loan = await pool.loans(0)
			expect(loan.status).to.equal(1) // Active

			// Repay triggers activity notification
			const repayAmount = hre.ethers.parseEther('5.5')

			await expect(pool.connect(alice).repayLoan(0, { value: repayAmount }))
				.to.emit(registry, 'ActivityNotified')
				.withArgs(alice.address, await pool.getAddress())
		})
	})
})
