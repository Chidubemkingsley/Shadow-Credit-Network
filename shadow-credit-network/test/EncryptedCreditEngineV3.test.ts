import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { expect } from 'chai'

describe('EncryptedCreditEngineV3', function () {
	async function deployEngineFixture() {
		const [owner, alice, bob, charlie, feeReceiver] = await hre.ethers.getSigners()

		const EncryptedCreditEngine = await hre.ethers.getContractFactory('EncryptedCreditEngineV3')
		const engine = await EncryptedCreditEngine.connect(owner).deploy(owner.address)

		// Deploy ReputationRegistry to test the hook
		const ReputationRegistry = await hre.ethers.getContractFactory('ReputationRegistry')
		const registry = await ReputationRegistry.deploy(owner.address, 90 * 86400, 2)
		await engine.connect(owner).setReputationRegistry(await registry.getAddress())
		await registry.connect(owner).setIntegrationContract(await engine.getAddress())

		return { engine, registry, owner, alice, bob, charlie, feeReceiver }
	}

	beforeEach(function () {
		if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
	})

	describe('Core Flow & Expiry', function () {
		it('Should enforce score expiry', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await engine.connect(alice).register()
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const [encIncome] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(100_000n)] as const))
			const [encDebt] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(20_000n)] as const))
			const [enc32] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(8000n)] as const))

			await engine.connect(alice).submitCreditData(encIncome, encDebt, enc32, enc32, enc32, enc32)
			await engine.connect(alice).computeCreditScore()

			expect(await engine.hasCreditScore(alice.address)).to.be.true
			expect(await engine.isScoreStale(alice.address)).to.be.false

			// Fast forward past validity period (180 days)
			await hre.network.provider.send("evm_increaseTime", [181 * 24 * 60 * 60])
			await hre.network.provider.send("evm_mine")

			expect(await engine.isScoreStale(alice.address)).to.be.true
		})

		it('Should trigger reputation hook on computeCreditScore', async function () {
			const { engine, registry, alice } = await loadFixture(deployEngineFixture)
			await registry.connect(alice).register()
			await engine.connect(alice).register()
			
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))
			const [encIncome] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(100_000n)] as const))
			const [encDebt] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(20_000n)] as const))
			const [enc32] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(8000n)] as const))

			await engine.connect(alice).submitCreditData(encIncome, encDebt, enc32, enc32, enc32, enc32)
			
			await expect(engine.connect(alice).computeCreditScore())
				.to.emit(registry, 'ActivityNotified')
				.withArgs(alice.address, await engine.getAddress())
		})

		it('Should enforce grantScoreAccess ACL', async function () {
			const { engine, alice, bob } = await loadFixture(deployEngineFixture)
			await engine.connect(alice).register()
			
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))
			const [encIncome] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(100_000n)] as const))
			const [encDebt] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(20_000n)] as const))
			const [enc32] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(8000n)] as const))

			await engine.connect(alice).submitCreditData(encIncome, encDebt, enc32, enc32, enc32, enc32)
			await engine.connect(alice).computeCreditScore()

			// Unathorized contract should revert
			await expect(engine.connect(alice).grantScoreAccess(bob.address))
				.to.be.revertedWithCustomError(engine, 'NotAuthorizedContract')

			// Owner authorizes contract
			await engine.authorizeContract(bob.address)
			
			// Should succeed now
			await expect(engine.connect(alice).grantScoreAccess(bob.address)).to.not.be.reverted
		})
	})
})
