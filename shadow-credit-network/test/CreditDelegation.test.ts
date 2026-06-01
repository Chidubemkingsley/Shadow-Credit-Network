import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import hre from 'hardhat'
import { cofhejs, Encryptable } from 'cofhejs/node'
import { expect } from 'chai'

describe('CreditDelegationV2', function () {
	async function deployDelegationFixture() {
		const [owner, alice, bob, charlie] = await hre.ethers.getSigners()

		const DelegationV2 = await hre.ethers.getContractFactory('CreditDelegationV2')
		const delegation = await DelegationV2.connect(owner).deploy(owner.address)

		return { delegation, owner, alice, bob, charlie }
	}

	async function deployWithEngineFixture() {
		const [owner, alice, bob] = await hre.ethers.getSigners()

		const DelegationV2 = await hre.ethers.getContractFactory('CreditDelegationV2')
		const delegation = await DelegationV2.connect(owner).deploy(owner.address)

		const Engine = await hre.ethers.getContractFactory('EncryptedCreditEngineV3')
		const engine = await Engine.connect(owner).deploy(owner.address)
		await delegation.connect(owner).setCreditEngine(await engine.getAddress())

		return { delegation, engine, owner, alice, bob }
	}

	async function submitCreditDataForBob(engine: any, bob: any) {
		await engine.connect(bob).register()
		await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(bob))
		const [encIncome] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(200_000n)] as const))
		const [encDebt] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(10_000n)] as const))
		const [encPaymentHistory] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(9500n)] as const))
		const [encUtilization] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(3000n)] as const))
		const [encAccountAge] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(1825n)] as const))
		const [encDefaults] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint32(0n)] as const))
		await engine.connect(bob).submitCreditData(encIncome, encDebt, encPaymentHistory, encUtilization, encAccountAge, encDefaults)
		await engine.connect(bob).computeCreditScore()
	}

	beforeEach(function () {
		if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
	})

	describe('Deployment', function () {
		it('Should set the correct owner', async function () {
			const { delegation, owner } = await loadFixture(deployDelegationFixture)
			expect(await delegation.owner()).to.equal(owner.address)
		})
	})

	describe('Offer Management', function () {
		it('Should create a delegation offer', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)

			await expect(
				delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			).to.emit(delegation, 'DelegationOfferCreated')

			expect(await delegation.offerCount()).to.equal(1)
			const offers = await delegation.getDelegatorOffers(alice.address)
			expect(offers.length).to.equal(1)
		})

		it('Should set offer status to Active', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			const [, , , , , , , status] = await delegation.getOffer(0)
			expect(status).to.equal(0)
		})

		it('Should cancel an offer', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)

			await expect(delegation.connect(alice).cancelOffer(0))
				.to.emit(delegation, 'DelegationOfferCancelled')

			const [, , , , , , , status] = await delegation.getOffer(0)
			expect(status).to.equal(1)
		})

		it('Should revert cancel from non-delegator', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await expect(delegation.connect(bob).cancelOffer(0)).to.be.revertedWithCustomError(
				delegation, 'NotDelegator'
			)
		})

		it('Should revert cancel of non-active offer', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(alice).cancelOffer(0)
			await expect(delegation.connect(alice).cancelOffer(0)).to.be.revertedWithCustomError(
				delegation, 'OfferNotActive'
			)
		})
	})

	describe('Offer Acceptance', function () {
		it('Should accept an offer and create a bond without engine', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)

			await expect(
				delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)
			).to.emit(delegation, 'DelegationAccepted')

			expect(await delegation.bondCount()).to.equal(1)
			// Without engine, bond goes directly to Active (1)
			const [, , , , , , , , bondStatus] = await delegation.getBond(0)
			expect(bondStatus).to.equal(1)
		})

		it('Should create bond as PendingApproval with engine and minScore', async function () {
			const { delegation, engine, alice, bob } = await loadFixture(deployWithEngineFixture)
			// Register bob with the engine
			await engine.connect(bob).register()
			await engine.connect(bob).computeCreditScore()

			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 580, 3)

			await expect(
				delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)
			).to.emit(delegation, 'DelegationAccepted')

			// Bond should be PendingApproval (0)
			const [, , , , , , , , bondStatus] = await delegation.getBond(0)
			expect(bondStatus).to.equal(0)
		})

		it('Should use defaultBondDuration when duration is 0', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 0)

			const [, , , , , , , dueDate] = await delegation.getBond(0)
			const block = await hre.ethers.provider.getBlock('latest')
			const expectedDue = BigInt(block!.timestamp) + 30n * 86400n
			expect(dueDate).to.be.closeTo(expectedDue, 5n)
		})

		it('Should prevent self-delegation', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await expect(
				delegation.connect(alice).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)
			).to.be.revertedWithCustomError(delegation, 'SelfDelegation')
		})

		it('Should revert on cancelled offer', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(alice).cancelOffer(0)
			await expect(
				delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)
			).to.be.revertedWithCustomError(delegation, 'OfferNotActive')
		})
	})

	describe('Credit Engine Integration', function () {
		it('Should reject acceptOffer when borrower has no score', async function () {
			const { delegation, engine, alice, bob } = await loadFixture(deployWithEngineFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)

			await expect(
				delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)
			).to.be.revertedWithCustomError(delegation, 'NoCreditScore')
		})

			it('Should resolve credit check and activate bond', async function () {
			const { delegation, engine, alice, bob } = await loadFixture(deployWithEngineFixture)
			await submitCreditDataForBob(engine, bob)

			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 580, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)

			// Advance time past mock async decryption delay (offset = (timestamp % 10) + 1, max 10)
			await hre.network.provider.send("evm_increaseTime", [12])
			await hre.network.provider.send("evm_mine", [])

			// Resolve credit check
			await expect(delegation.resolveCreditCheck(0))
				.to.emit(delegation, 'CreditCheckResolved')
				.withArgs(0, true)

			const [, , , , , , , , bondStatus] = await delegation.getBond(0)
			expect(bondStatus).to.equal(1) // Active
		})
	})

	describe('Repayment', function () {
		it('Should accept partial repayment', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('5'), 30 * 86400)

			await delegation.connect(bob).repayBond(0, { value: hre.ethers.parseEther('1') })

			const [, , , repaid] = await delegation.getBond(0)
			expect(repaid).to.be.gt(0n)
			const [, , , , , , , , s] = await delegation.getBond(0)
			expect(s).to.equal(1) // Still Active
		})

		it('Should forward yield to delegator and emit YieldPaidOut', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)

			const balanceBefore = await hre.ethers.provider.getBalance(alice.address)

			await expect(
				delegation.connect(bob).repayBond(0, { value: hre.ethers.parseEther('1') })
			).to.emit(delegation, 'YieldPaidOut')

			const balanceAfter = await hre.ethers.provider.getBalance(alice.address)
			expect(balanceAfter).to.be.gt(balanceBefore)
		})

		it('Should revert repayment from non-borrower', async function () {
			const { delegation, alice, bob, charlie } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)
			await expect(
				delegation.connect(charlie).repayBond(0, { value: hre.ethers.parseEther('1') })
			).to.be.revertedWithCustomError(delegation, 'NotBorrower')
		})

		it('Should revert zero-value repayment', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)
			await expect(
				delegation.connect(bob).repayBond(0, { value: 0 })
			).to.be.revertedWithCustomError(delegation, 'NoYieldToClaim')
		})

		it('Should mark bond as repaid after sufficient repayment', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)

			await delegation.connect(bob).repayBond(0, { value: hre.ethers.parseEther('2.11') })
			const [, , , , , , , , s] = await delegation.getBond(0)
			expect(s).to.equal(2) // Repaid
		})
	})

	describe('Default', function () {
		it('Should mark bond as defaulted (owner)', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)

			await expect(delegation.connect(owner).markDefaulted(0))
				.to.emit(delegation, 'DelegationDefaulted')

			const [, , , , , , , , s] = await delegation.getBond(0)
			expect(s).to.equal(3) // Defaulted
		})

		it('Should allow markExpiredDefault after dueDate', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 1)

			await hre.network.provider.send('evm_increaseTime', [2])
			await hre.network.provider.send('evm_mine', [])

			await expect(delegation.connect(alice).markExpiredDefault(0))
				.to.emit(delegation, 'DelegationDefaulted')

			const [, , , , , , , , s] = await delegation.getBond(0)
			expect(s).to.equal(3) // Defaulted
		})

		it('Should revert markExpiredDefault before dueDate', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)

			await expect(
				delegation.connect(alice).markExpiredDefault(0)
			).to.be.revertedWithCustomError(delegation, 'BondNotExpired')
		})
	})

	describe('Read-Only Queries', function () {
		it('Should revert on invalid offer query', async function () {
			const { delegation } = await loadFixture(deployDelegationFixture)
			await expect(delegation.getOffer(999)).to.be.revertedWithCustomError(
				delegation, 'OfferNotFound'
			)
		})

		it('Should revert on invalid bond query', async function () {
			const { delegation } = await loadFixture(deployDelegationFixture)
			await expect(delegation.getBond(999)).to.be.revertedWithCustomError(
				delegation, 'BondNotFound'
			)
		})

		it('Should return bond approval info', async function () {
			const { delegation, engine, alice, bob } = await loadFixture(deployWithEngineFixture)
			await engine.connect(bob).register()
			await engine.connect(bob).computeCreditScore()
			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 580, 3)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('2'), 30 * 86400)

			const [checkId, eboolCtHash, pending] = await delegation.getBondApproval(0)
			expect(checkId).to.not.equal(hre.ethers.ZeroHash)
			expect(eboolCtHash).to.not.equal(0n)
			expect(pending).to.equal(true)
		})
	})

	describe('Full Flow', function () {
		it('Should complete full delegation lifecycle without engine', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)

			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 670, 5)
			const [, , , , , , , offerStatus] = await delegation.getOffer(0)
			expect(offerStatus).to.equal(0)

			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('3'), 30 * 86400)
			// Without engine, bond is Active (1)
			const [, , , , , , , , bondStatus] = await delegation.getBond(0)
			expect(bondStatus).to.equal(1)

			await delegation.connect(bob).repayBond(0, { value: hre.ethers.parseEther('3.16') })
			const [, , , , , , , , repaid] = await delegation.getBond(0)
			expect(repaid).to.equal(2) // Repaid

			const [, , , , , activeCount] = await delegation.getOffer(0)
			expect(activeCount).to.equal(0)
		})

		it('Should complete full delegation lifecycle with engine', async function () {
			const { delegation, engine, alice, bob } = await loadFixture(deployWithEngineFixture)
			await submitCreditDataForBob(engine, bob)

			await delegation.connect(alice).createOffer(hre.ethers.parseEther('10'), 500, 580, 5)
			await delegation.connect(bob).acceptOffer(0, hre.ethers.parseEther('3'), 30 * 86400)

			// Bond is PendingApproval (0)
			let [, , , , , , , , s] = await delegation.getBond(0)
			expect(s).to.equal(0)

			// Advance time past mock async decryption delay
			await hre.network.provider.send("evm_increaseTime", [12])
			await hre.network.provider.send("evm_mine", [])

			// Resolve — in mock env, resolves with approved=true
			await delegation.resolveCreditCheck(0)
			;[, , , , , , , , s] = await delegation.getBond(0)
			expect(s).to.equal(1) // Active

			// Full repayment
			await delegation.connect(bob).repayBond(0, { value: hre.ethers.parseEther('3.16') })
			;[, , , , , , , , s] = await delegation.getBond(0)
			expect(s).to.equal(2) // Repaid
		})
	})
})
