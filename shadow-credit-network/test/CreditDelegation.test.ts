import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { expect } from 'chai'

describe('CreditDelegation', function () {
	async function deployDelegationFixture() {
		const [owner, alice, bob, charlie, dave, feeReceiver] = await hre.ethers.getSigners()

		const CreditDelegation = await hre.ethers.getContractFactory('CreditDelegation')
		const delegation = await CreditDelegation.connect(owner).deploy(owner.address, feeReceiver.address)

		return { delegation, owner, alice, bob, charlie, dave, feeReceiver }
	}

	async function createOffer(delegation: any, delegator: any, maxAmount: bigint, yieldRate: number, minScore: number, maxBonds: number) {
		await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(delegator))
		const [encMax] = await hre.cofhe.expectResultSuccess(
			cofhejs.encrypt([Encryptable.uint64(maxAmount)] as const)
		)
		const [encRate] = await hre.cofhe.expectResultSuccess(
			cofhejs.encrypt([Encryptable.uint32(BigInt(yieldRate))] as const)
		)
		const [encMinScore] = await hre.cofhe.expectResultSuccess(
			cofhejs.encrypt([Encryptable.uint32(BigInt(minScore))] as const)
		)
		return delegation.connect(delegator).createOffer(encMax, encRate, encMinScore, maxBonds)
	}

	async function acceptOffer(delegation: any, borrower: any, offerId: number, amount: bigint, duration: number) {
		await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(borrower))
		const [encAmount] = await hre.cofhe.expectResultSuccess(
			cofhejs.encrypt([Encryptable.uint64(amount)] as const)
		)
		const [encDuration] = await hre.cofhe.expectResultSuccess(
			cofhejs.encrypt([Encryptable.uint32(BigInt(duration))] as const)
		)
		return delegation.connect(borrower).acceptOffer(offerId, encAmount, encDuration)
	}

	beforeEach(function () {
		if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
	})

	afterEach(function () {
		if (!hre.cofhe.isPermittedEnvironment('MOCK')) return
	})

	// ──────────────────────────────────────────────
	//  Deployment
	// ──────────────────────────────────────────────

	describe('Deployment', function () {
		it('Should set the correct owner', async function () {
			const { delegation, owner } = await loadFixture(deployDelegationFixture)
			expect(await delegation.owner()).to.equal(owner.address)
		})

		it('Should set the correct fee receiver', async function () {
			const { delegation, feeReceiver } = await loadFixture(deployDelegationFixture)
			expect(await delegation.feeReceiver()).to.equal(feeReceiver.address)
		})

		it('Should set default parameters', async function () {
			const { delegation } = await loadFixture(deployDelegationFixture)
			expect(await delegation.maxOffersPerDelegator()).to.equal(10)
			expect(await delegation.maxBondsPerBorrower()).to.equal(5)
			expect(await delegation.protocolFee()).to.equal(100)
		})
	})

	// ──────────────────────────────────────────────
	//  Offer Management
	// ──────────────────────────────────────────────

	describe('Offer Management', function () {
		it('Should create a delegation offer', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await expect(
				createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			).to.emit(delegation, 'DelegationOfferCreated')

			expect(await delegation.offerCount()).to.equal(1)
			expect(await delegation.getDelegatorOfferCount(alice.address)).to.equal(1)
		})

		it('Should set offer status to Active', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)

			expect(await delegation.getOfferStatus(0)).to.equal(0) // Active
		})

		it('Should cancel an offer', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)

			await expect(delegation.connect(alice).cancelOffer(0))
				.to.emit(delegation, 'DelegationOfferCancelled')

			expect(await delegation.getOfferStatus(0)).to.equal(1) // Cancelled
		})

		it('Should revert cancel from non-delegator', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)

			await expect(delegation.connect(bob).cancelOffer(0)).to.be.revertedWithCustomError(
				delegation,
				'NotDelegator'
			)
		})

		it('Should revert cancel of non-active offer', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await delegation.connect(alice).cancelOffer(0)

			await expect(delegation.connect(alice).cancelOffer(0)).to.be.revertedWithCustomError(
				delegation,
				'OfferNotActive'
			)
		})

		it('Should revert cancel of invalid offer', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await expect(delegation.connect(alice).cancelOffer(999)).to.be.revertedWithCustomError(
				delegation,
				'OfferNotFound'
			)
		})
	})

	// ──────────────────────────────────────────────
	//  Offer Acceptance (Bond Creation)
	// ──────────────────────────────────────────────

	describe('Offer Acceptance', function () {
		it('Should accept an offer and create a bond', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)

			await expect(
				acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)
			).to.emit(delegation, 'DelegationAccepted')

			expect(await delegation.bondCount()).to.equal(1)
			expect(await delegation.getBondStatus(0)).to.equal(0) // Active
		})

		it('Should increment active bond count on offer', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)

			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			const [, , , , , , activeCount] = await delegation.getOffer(0)
			expect(activeCount).to.equal(1)
		})

		it('Should track bonds per borrower', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)

			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			const bonds = await delegation.getBorrowerBonds(bob.address)
			expect(bonds.length).to.equal(1)
		})

		it('Should track bonds per delegator', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)

			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			const bonds = await delegation.getDelegatorBonds(alice.address)
			expect(bonds.length).to.equal(1)
		})

		it('Should prevent self-delegation', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)

			await expect(
				acceptOffer(delegation, alice, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)
			).to.be.revertedWithCustomError(delegation, 'SelfDelegation')
		})

		it('Should prevent circular delegation', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)

			// Alice creates offer, Bob accepts
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 5)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			// Bob creates offer, Alice tries to accept — circular!
			await createOffer(delegation, bob, hre.ethers.parseEther('10').valueOf(), 500, 670, 5)
			await expect(
				acceptOffer(delegation, alice, 1, hre.ethers.parseEther('1').valueOf(), 90 * 86400)
			).to.be.revertedWithCustomError(delegation, 'CircularDelegation')
		})

		it('Should revert on cancelled offer', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await delegation.connect(alice).cancelOffer(0)

			await expect(
				acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)
			).to.be.revertedWithCustomError(delegation, 'OfferNotActive')
		})

		it('Should revert on invalid offer ID', async function () {
			const { delegation, bob } = await loadFixture(deployDelegationFixture)

			await expect(
				acceptOffer(delegation, bob, 999, hre.ethers.parseEther('2').valueOf(), 90 * 86400)
			).to.be.revertedWithCustomError(delegation, 'OfferNotFound')
		})
	})

	// ──────────────────────────────────────────────
	//  Blacklisting
	// ──────────────────────────────────────────────

	describe('Blacklisting', function () {
		it('Should blacklist a borrower', async function () {
			const { delegation, owner, bob } = await loadFixture(deployDelegationFixture)

			await expect(delegation.connect(owner).blacklistBorrower(bob.address))
				.to.emit(delegation, 'BorrowerBlacklistedEvent')

			expect(await delegation.blacklistedBorrowers(bob.address)).to.be.true
		})

		it('Should unblacklist a borrower', async function () {
			const { delegation, owner, bob } = await loadFixture(deployDelegationFixture)
			await delegation.connect(owner).blacklistBorrower(bob.address)

			await expect(delegation.connect(owner).unblacklistBorrower(bob.address))
				.to.emit(delegation, 'BorrowerUnblacklisted')

			expect(await delegation.blacklistedBorrowers(bob.address)).to.be.false
		})

		it('Should revert offer acceptance from blacklisted borrower', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await delegation.connect(owner).blacklistBorrower(bob.address)

			await expect(
				acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)
			).to.be.revertedWithCustomError(delegation, 'BorrowerIsBlacklisted')
		})

		it('Should not allow non-owner to blacklist', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)

			await expect(
				delegation.connect(alice).blacklistBorrower(bob.address)
			).to.be.revertedWithCustomError(delegation, 'OwnableUnauthorizedAccount')
		})
	})

	// ──────────────────────────────────────────────
	//  Repayment
	// ──────────────────────────────────────────────

	describe('Repayment', function () {
		it('Should record a repayment', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			await expect(
				delegation.connect(bob).recordRepayment(0, { value: hre.ethers.parseEther('0.5') })
			).to.emit(delegation, 'DelegationRepaymentMade')
		})

		it('Should revert repayment from non-borrower', async function () {
			const { delegation, alice, bob, charlie } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			await expect(
				delegation.connect(charlie).recordRepayment(0, { value: hre.ethers.parseEther('0.5') })
			).to.be.revertedWithCustomError(delegation, 'NotBorrower')
		})

		it('Should revert zero repayment', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			await expect(
				delegation.connect(bob).recordRepayment(0, { value: 0 })
			).to.be.reverted
		})

		it('Should mark bond as repaid', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			await delegation.connect(owner).markBondRepaid(0)
			expect(await delegation.getBondStatus(0)).to.equal(1) // Repaid
		})

		it('Should restore offer availability after repayment', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			// getOffer returns: (delegator, maxAmt, yieldRate, minScore, available, status, activeBondCount, maxBonds)
			const [, , , , , statusBefore, activeCountBefore] = await delegation.getOffer(0)
			expect(activeCountBefore).to.equal(1)

			await delegation.connect(owner).markBondRepaid(0)

			const [, , , , , statusAfter, activeCountAfter] = await delegation.getOffer(0)
			expect(activeCountAfter).to.equal(0)
			expect(statusAfter).to.equal(0) // Back to Active
		})
	})

	// ──────────────────────────────────────────────
	//  Default Handling
	// ──────────────────────────────────────────────

	describe('Default Handling', function () {
		it('Should mark bond as defaulted', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			await expect(delegation.connect(owner).markBondDefaulted(0))
				.to.emit(delegation, 'DelegationDefaulted')

			expect(await delegation.getBondStatus(0)).to.equal(2) // Defaulted
		})

		it('Should emit penalty event on default', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			await expect(delegation.connect(owner).markBondDefaulted(0))
				.to.emit(delegation, 'DelegationPenaltyApplied')
		})

		it('Should decrement offer active count on default', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			await delegation.connect(owner).markBondDefaulted(0)

			const [, , , , , , activeCount] = await delegation.getOffer(0)
			expect(activeCount).to.equal(0)
		})

		it('Should not allow non-owner to mark defaulted', async function () {
			const { delegation, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			await expect(
				delegation.connect(bob).markBondDefaulted(0)
			).to.be.revertedWithCustomError(delegation, 'OwnableUnauthorizedAccount')
		})
	})

	// ──────────────────────────────────────────────
	//  Borrowed Amount Tracking
	// ──────────────────────────────────────────────

	describe('Borrowed Amount Tracking', function () {
		it('Should record borrowed amount', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner))
			const [encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(hre.ethers.parseEther('1').valueOf())] as const)
			)

			await delegation.connect(owner).recordBorrowed(0, encAmount)
		})

		it('Should revert recording on inactive bond', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)
			await delegation.connect(owner).markBondRepaid(0)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner))
			const [encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(hre.ethers.parseEther('1').valueOf())] as const)
			)

			await expect(
				delegation.connect(owner).recordBorrowed(0, encAmount)
			).to.be.revertedWithCustomError(delegation, 'BondNotActive')
		})
	})

	// ──────────────────────────────────────────────
	//  Yield Claims
	// ──────────────────────────────────────────────

	describe('Yield Claims', function () {
		it('Should revert claim yield from non-delegator', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 3)
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('2').valueOf(), 90 * 86400)

			await expect(
				delegation.connect(bob).claimYield(0)
			).to.be.revertedWithCustomError(delegation, 'NotDelegator')
		})
	})

	// ──────────────────────────────────────────────
	//  Read-Only Queries
	// ──────────────────────────────────────────────

	describe('Read-Only Queries', function () {
		it('Should revert on invalid offer query', async function () {
			const { delegation } = await loadFixture(deployDelegationFixture)
			await expect(delegation.getOfferStatus(999)).to.be.revertedWithCustomError(
				delegation,
				'OfferNotFound'
			)
		})

		it('Should revert on invalid bond query', async function () {
			const { delegation } = await loadFixture(deployDelegationFixture)
			await expect(delegation.getBondStatus(999)).to.be.revertedWithCustomError(
				delegation,
				'BondNotFound'
			)
		})
	})

	// ──────────────────────────────────────────────
	//  Admin Functions
	// ──────────────────────────────────────────────

	describe('Admin Functions', function () {
		it('Should set credit engine', async function () {
			const { delegation, owner, alice } = await loadFixture(deployDelegationFixture)
			await expect(delegation.connect(owner).setCreditEngine(alice.address))
				.to.emit(delegation, 'CreditEngineSet')
		})

		it('Should update fee params', async function () {
			const { delegation, owner } = await loadFixture(deployDelegationFixture)
			await delegation.connect(owner).updateFeeParams(200, 20, 10, 180 * 86400)

			expect(await delegation.protocolFee()).to.equal(200)
			expect(await delegation.maxOffersPerDelegator()).to.equal(20)
			expect(await delegation.maxBondsPerBorrower()).to.equal(10)
		})

		it('Should update fee receiver', async function () {
			const { delegation, owner, alice } = await loadFixture(deployDelegationFixture)
			await delegation.connect(owner).setFeeReceiver(alice.address)
			expect(await delegation.feeReceiver()).to.equal(alice.address)
		})

		it('Should not allow non-owner to update params', async function () {
			const { delegation, alice } = await loadFixture(deployDelegationFixture)
			await expect(
				delegation.connect(alice).updateFeeParams(0, 0, 0, 0)
			).to.be.revertedWithCustomError(delegation, 'OwnableUnauthorizedAccount')
		})
	})

	// ──────────────────────────────────────────────
	//  Full Flow
	// ──────────────────────────────────────────────

	describe('Full Flow', function () {
		it('Should complete full delegation lifecycle', async function () {
			const { delegation, owner, alice, bob } = await loadFixture(deployDelegationFixture)

			// 1. Alice creates a delegation offer
			await createOffer(delegation, alice, hre.ethers.parseEther('10').valueOf(), 500, 670, 5)
			expect(await delegation.getOfferStatus(0)).to.equal(0) // Active

			// 2. Bob accepts the offer
			await acceptOffer(delegation, bob, 0, hre.ethers.parseEther('3').valueOf(), 90 * 86400)
			expect(await delegation.getBondStatus(0)).to.equal(0) // Active

			// 3. Owner records borrowed amount
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner))
			const [encBorrowed] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(hre.ethers.parseEther('2').valueOf())] as const)
			)
			await delegation.connect(owner).recordBorrowed(0, encBorrowed)

			// 4. Bob repays
			await delegation.connect(bob).recordRepayment(0, { value: hre.ethers.parseEther('1') })

			// 5. Owner marks bond as repaid
			await delegation.connect(owner).markBondRepaid(0)
			expect(await delegation.getBondStatus(0)).to.equal(1) // Repaid

			// 6. Verify offer state restored
			const [, , , , , status, activeCount] = await delegation.getOffer(0)
			expect(status).to.equal(0) // Active again
			expect(activeCount).to.equal(0)
		})
	})
})
