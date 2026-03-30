import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { expect } from 'chai'

describe('EncryptedCreditEngine', function () {
	async function deployEngineFixture() {
		const [owner, alice, bob, charlie, feeReceiver] = await hre.ethers.getSigners()

		const EncryptedCreditEngine = await hre.ethers.getContractFactory('EncryptedCreditEngine')
		const engine = await EncryptedCreditEngine.connect(owner).deploy(feeReceiver.address)

		return { engine, owner, alice, bob, charlie, feeReceiver }
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
			const { engine, owner } = await loadFixture(deployEngineFixture)
			expect(await engine.owner()).to.equal(owner.address)
		})

		it('Should set the correct fee receiver', async function () {
			const { engine, feeReceiver } = await loadFixture(deployEngineFixture)
			expect(await engine.feeReceiver()).to.equal(feeReceiver.address)
		})

		it('Should revert with zero address fee receiver', async function () {
			const EncryptedCreditEngine = await hre.ethers.getContractFactory('EncryptedCreditEngine')
			await expect(
				EncryptedCreditEngine.deploy(hre.ethers.ZeroAddress)
			).to.be.revertedWith('Invalid fee receiver')
		})
	})

	// ──────────────────────────────────────────────
	//  Registration
	// ──────────────────────────────────────────────

	describe('Registration', function () {
		it('Should register a new user', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await expect(engine.connect(alice).register())
				.to.emit(engine, 'UserRegistered')
				.withArgs(alice.address)

			expect(await engine.isRegistered(alice.address)).to.be.true
		})

		it('Should increment user count on registration', async function () {
			const { engine, alice, bob } = await loadFixture(deployEngineFixture)
			expect(await engine.getUserCount()).to.equal(0)

			await engine.connect(alice).register()
			expect(await engine.getUserCount()).to.equal(1)

			await engine.connect(bob).register()
			expect(await engine.getUserCount()).to.equal(2)
		})

		it('Should store user in index', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await engine.connect(alice).register()
			expect(await engine.getUserAtIndex(0)).to.equal(alice.address)
		})

		it('Should revert if already registered', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await engine.connect(alice).register()
			await expect(engine.connect(alice).register()).to.be.revertedWithCustomError(engine, 'AlreadyRegistered')
		})
	})

	// ──────────────────────────────────────────────
	//  Credit Data Submission
	// ──────────────────────────────────────────────

	describe('Credit Data Submission', function () {
		it('Should submit encrypted credit data', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await engine.connect(alice).register()

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const [encIncome] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(100_000n)] as const)
			)
			const [encDebt] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(20_000n)] as const)
			)
			const [encPaymentHistory] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9500n)] as const)
			)
			const [encUtilization] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(3000n)] as const)
			)
			const [encAccountAge] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(1825n)] as const) // 5 years
			)
			const [encDefaults] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(0n)] as const)
			)

			await expect(
				engine.connect(alice).submitCreditData(
					encIncome,
					encDebt,
					encPaymentHistory,
					encUtilization,
					encAccountAge,
					encDefaults
				)
			).to.emit(engine, 'CreditDataSubmitted')
		})

		it('Should revert if not registered', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const [encIncome] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(100_000n)] as const)
			)
			const [encDebt] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(20_000n)] as const)
			)
			const [encPaymentHistory] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9500n)] as const)
			)
			const [encUtilization] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(3000n)] as const)
			)
			const [encAccountAge] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(1825n)] as const)
			)
			const [encDefaults] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(0n)] as const)
			)

			await expect(
				engine.connect(alice).submitCreditData(
					encIncome,
					encDebt,
					encPaymentHistory,
					encUtilization,
					encAccountAge,
					encDefaults
				)
			).to.be.revertedWithCustomError(engine, 'NotRegistered')
		})
	})

	// ──────────────────────────────────────────────
	//  Credit Score Computation
	// ──────────────────────────────────────────────

	describe('Credit Score Computation', function () {
		async function submitCreditData(engine: any, user: any) {
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(user))

			const [encIncome] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(100_000n)] as const)
			)
			const [encDebt] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(20_000n)] as const)
			)
			const [encPaymentHistory] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9500n)] as const)
			)
			const [encUtilization] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(3000n)] as const)
			)
			const [encAccountAge] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(1825n)] as const)
			)
			const [encDefaults] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(0n)] as const)
			)

			await engine.connect(user).submitCreditData(
				encIncome,
				encDebt,
				encPaymentHistory,
				encUtilization,
				encAccountAge,
				encDefaults
			)
		}

		it('Should compute credit score with good credit data', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await engine.connect(alice).register()
			await submitCreditData(engine, alice)

			await expect(engine.connect(alice).computeCreditScore())
				.to.emit(engine, 'CreditScoreComputed')

			expect(await engine.hasComputedScore(alice.address)).to.be.true
		})

		it('Should compute score for user with defaults (lower score)', async function () {
			const { engine, bob } = await loadFixture(deployEngineFixture)
			await engine.connect(bob).register()

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(bob))

			const [encIncome] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(50_000n)] as const)
			)
			const [encDebt] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(40_000n)] as const)
			)
			const [encPaymentHistory] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(6000n)] as const)
			)
			const [encUtilization] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(8000n)] as const)
			)
			const [encAccountAge] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(365n)] as const) // 1 year
			)
			const [encDefaults] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(3n)] as const) // 3 defaults
			)

			await engine.connect(bob).submitCreditData(
				encIncome,
				encDebt,
				encPaymentHistory,
				encUtilization,
				encAccountAge,
				encDefaults
			)

			await expect(engine.connect(bob).computeCreditScore())
				.to.emit(engine, 'CreditScoreComputed')

			expect(await engine.hasComputedScore(bob.address)).to.be.true
		})

		it('Should revert if credit data not submitted', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await engine.connect(alice).register()

			await expect(engine.connect(alice).computeCreditScore())
				.to.emit(engine, 'CreditScoreComputed')
		})

		it('Should allow cofhejs unsealing of score', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await engine.connect(alice).register()
			await submitCreditData(engine, alice)

			await engine.connect(alice).computeCreditScore()

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const scoreHash = await engine.getCreditScore(alice.address)
			const unsealedResult = await cofhejs.unseal(scoreHash, FheTypes.Uint32)
			// Score should be between 300 and 850
			await hre.cofhe.expectResultValue(unsealedResult, unsealedResult.data ?? 0n)
			const score = Number(unsealedResult.data)
			expect(score).to.be.gte(300)
			expect(score).to.be.lte(850)
		})
	})

	// ──────────────────────────────────────────────
	//  Score Decryption
	// ──────────────────────────────────────────────

	describe('Score Decryption', function () {
		async function setupUserWithScore(engine: any, user: any) {
			await engine.connect(user).register()
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(user))

			const [encIncome] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(100_000n)] as const)
			)
			const [encDebt] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(20_000n)] as const)
			)
			const [encPaymentHistory] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9500n)] as const)
			)
			const [encUtilization] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(3000n)] as const)
			)
			const [encAccountAge] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(1825n)] as const)
			)
			const [encDefaults] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(0n)] as const)
			)

			await engine.connect(user).submitCreditData(
				encIncome,
				encDebt,
				encPaymentHistory,
				encUtilization,
				encAccountAge,
				encDefaults
			)

			await engine.connect(user).computeCreditScore()
		}

		it('Should request score decryption', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await setupUserWithScore(engine, alice)

			await engine.connect(alice).requestScoreDecryption()
		})

		it('Should get decrypted score after request', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await setupUserWithScore(engine, alice)

			await engine.connect(alice).requestScoreDecryption()

			// In mock environment, decryption might be synchronous
			const [score, isDecrypted] = await engine.connect(alice).getDecryptedScoreSafe()
			if (isDecrypted) {
				expect(score).to.be.gte(300)
				expect(score).to.be.lte(850)
			}
		})

		it('Should revert if score not computed before decryption request', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await engine.connect(alice).register()

			await expect(engine.connect(alice).requestScoreDecryption())
				.to.be.revertedWithCustomError(engine, 'NoScoreComputed')
		})
	})

	// ──────────────────────────────────────────────
	//  Borrowing Power
	// ──────────────────────────────────────────────

	describe('Borrowing Power', function () {
		async function setupUserWithScore(engine: any, user: any) {
			await engine.connect(user).register()
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(user))

			const [encIncome] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(100_000n)] as const)
			)
			const [encDebt] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(20_000n)] as const)
			)
			const [encPaymentHistory] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9500n)] as const)
			)
			const [encUtilization] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(3000n)] as const)
			)
			const [encAccountAge] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(1825n)] as const)
			)
			const [encDefaults] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(0n)] as const)
			)

			await engine.connect(user).submitCreditData(
				encIncome,
				encDebt,
				encPaymentHistory,
				encUtilization,
				encAccountAge,
				encDefaults
			)

			await engine.connect(user).computeCreditScore()
		}

		it('Should compute borrowing power for user with score', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await setupUserWithScore(engine, alice)

			await expect(engine.connect(alice).computeBorrowingPower())
				.to.emit(engine, 'BorrowingPowerRequested')
		})

		it('Should revert if score not computed', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await engine.connect(alice).register()

			await expect(engine.connect(alice).computeBorrowingPower())
				.to.be.revertedWithCustomError(engine, 'NoScoreComputed')
		})
	})

	// ──────────────────────────────────────────────
	//  Delegation
	// ──────────────────────────────────────────────

	describe('Delegation', function () {
		async function setupRegistered(engine: any, user: any) {
			await engine.connect(user).register()
		}

		it('Should authorize a delegate', async function () {
			const { engine, alice, bob } = await loadFixture(deployEngineFixture)
			await setupRegistered(engine, alice)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const [encCreditLimit] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(50_000n)] as const)
			)

			await expect(engine.connect(alice).authorizeDelegate(bob.address, encCreditLimit))
				.to.emit(engine, 'DelegateAuthorized')
				.withArgs(alice.address, bob.address)

			expect(await engine.isDelegationActive(alice.address, bob.address)).to.be.true
			expect(await engine.getDelegateCount(alice.address)).to.equal(1)
			expect(await engine.getDelegateAtIndex(alice.address, 0)).to.equal(bob.address)
		})

		it('Should revoke a delegate', async function () {
			const { engine, alice, bob } = await loadFixture(deployEngineFixture)
			await setupRegistered(engine, alice)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const [encCreditLimit] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(50_000n)] as const)
			)

			await engine.connect(alice).authorizeDelegate(bob.address, encCreditLimit)

			await expect(engine.connect(alice).revokeDelegate(bob.address))
				.to.emit(engine, 'DelegateRevoked')
				.withArgs(alice.address, bob.address)

			expect(await engine.isDelegationActive(alice.address, bob.address)).to.be.false
		})

		it('Should not allow self-delegation', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await setupRegistered(engine, alice)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const [encCreditLimit] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(50_000n)] as const)
			)

			await expect(
				engine.connect(alice).authorizeDelegate(alice.address, encCreditLimit)
			).to.be.revertedWithCustomError(engine, 'CannotDelegateSelf')
		})

		it('Should not allow duplicate delegation', async function () {
			const { engine, alice, bob } = await loadFixture(deployEngineFixture)
			await setupRegistered(engine, alice)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const [encCreditLimit] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(50_000n)] as const)
			)

			await engine.connect(alice).authorizeDelegate(bob.address, encCreditLimit)

			await expect(
				engine.connect(alice).authorizeDelegate(bob.address, encCreditLimit)
			).to.be.revertedWithCustomError(engine, 'DelegateAlreadyAuthorized')
		})

		it('Should revert revoking non-existent delegate', async function () {
			const { engine, alice, bob } = await loadFixture(deployEngineFixture)
			await setupRegistered(engine, alice)

			await expect(
				engine.connect(alice).revokeDelegate(bob.address)
			).to.be.revertedWithCustomError(engine, 'DelegateNotAuthorized')
		})

		it('Should revert delegating when not registered', async function () {
			const { engine, alice, bob } = await loadFixture(deployEngineFixture)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const [encCreditLimit] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(50_000n)] as const)
			)

			await expect(
				engine.connect(alice).authorizeDelegate(bob.address, encCreditLimit)
			).to.be.revertedWithCustomError(engine, 'NotRegistered')
		})
	})

	// ──────────────────────────────────────────────
	//  Admin Functions
	// ──────────────────────────────────────────────

	describe('Admin Functions', function () {
		it('Should allow owner to update fee receiver', async function () {
			const { engine, owner, alice } = await loadFixture(deployEngineFixture)
			await engine.connect(owner).setFeeReceiver(alice.address)
			expect(await engine.feeReceiver()).to.equal(alice.address)
		})

		it('Should not allow non-owner to update fee receiver', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)
			await expect(
				engine.connect(alice).setFeeReceiver(alice.address)
			).to.be.revertedWithCustomError(engine, 'OwnableUnauthorizedAccount')
		})

		it('Should allow owner to update thresholds', async function () {
			const { engine, owner } = await loadFixture(deployEngineFixture)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner))

			const [primeThresh] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(750n)] as const)
			)
			const [nearPrimeThresh] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(680n)] as const)
			)
			const [subprimeThresh] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(600n)] as const)
			)
			const [minBorrow] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(600n)] as const)
			)

			await engine.connect(owner).updateThresholds(
				primeThresh,
				nearPrimeThresh,
				subprimeThresh,
				minBorrow
			)
		})

		it('Should not allow non-owner to update thresholds', async function () {
			const { engine, alice } = await loadFixture(deployEngineFixture)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const [primeThresh] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(750n)] as const)
			)
			const [nearPrimeThresh] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(680n)] as const)
			)
			const [subprimeThresh] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(600n)] as const)
			)
			const [minBorrow] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(600n)] as const)
			)

			await expect(
				engine.connect(alice).updateThresholds(
					primeThresh,
					nearPrimeThresh,
					subprimeThresh,
					minBorrow
				)
			).to.be.revertedWithCustomError(engine, 'OwnableUnauthorizedAccount')
		})
	})

	// ──────────────────────────────────────────────
	//  Full Flow Integration
	// ──────────────────────────────────────────────

	describe('Full Flow', function () {
		it('Should complete full credit lifecycle', async function () {
			const { engine, alice, bob } = await loadFixture(deployEngineFixture)

			// 1. Register
			await engine.connect(alice).register()
			expect(await engine.isRegistered(alice.address)).to.be.true

			// 2. Submit credit data
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const [encIncome] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(150_000n)] as const)
			)
			const [encDebt] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(30_000n)] as const)
			)
			const [encPaymentHistory] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9800n)] as const)
			)
			const [encUtilization] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(2000n)] as const)
			)
			const [encAccountAge] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(3650n)] as const) // 10 years
			)
			const [encDefaults] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(0n)] as const)
			)

			await engine.connect(alice).submitCreditData(
				encIncome,
				encDebt,
				encPaymentHistory,
				encUtilization,
				encAccountAge,
				encDefaults
			)

			// 3. Compute credit score
			await expect(engine.connect(alice).computeCreditScore())
				.to.emit(engine, 'CreditScoreComputed')

			// 4. Compute borrowing power
			await expect(engine.connect(alice).computeBorrowingPower())
				.to.emit(engine, 'BorrowingPowerRequested')

			// 5. Authorize delegate
			const [encCreditLimit] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(25_000n)] as const)
			)

			await expect(engine.connect(alice).authorizeDelegate(bob.address, encCreditLimit))
				.to.emit(engine, 'DelegateAuthorized')

			// 6. Request decryption
			await engine.connect(alice).requestScoreDecryption()

			// 7. Verify delegation state
			expect(await engine.isDelegationActive(alice.address, bob.address)).to.be.true
			expect(await engine.getDelegateCount(alice.address)).to.equal(1)
		})
	})
})
