import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import hre from 'hardhat'
import { expect } from 'chai'

describe('PrivateLoanPool', function () {
	async function deployPoolFixture() {
		const [owner, alice, bob, charlie] = await hre.ethers.getSigners()

		const PrivateLoanPool = await hre.ethers.getContractFactory('PrivateLoanPool')
		const pool = await PrivateLoanPool.connect(owner).deploy(owner.address)

		const EncryptedCreditEngine = await hre.ethers.getContractFactory('EncryptedCreditEngine')
		const creditEngine = await EncryptedCreditEngine.connect(owner).deploy(owner.address)

		return { pool, creditEngine, owner, alice, bob, charlie }
	}

	async function fundPool(pool: any, funder: any, amount: bigint) {
		await pool.connect(funder).fundPool({ value: amount })
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
			const { pool, owner } = await loadFixture(deployPoolFixture)
			expect(await pool.owner()).to.equal(owner.address)
		})

		it('Should set default pool parameters', async function () {
			const { pool } = await loadFixture(deployPoolFixture)
			expect(await pool.minLoanAmount()).to.equal(hre.ethers.parseEther('0.01'))
			expect(await pool.maxLoanAmount()).to.equal(hre.ethers.parseEther('100'))
		})

		it('Should not be paused initially', async function () {
			const { pool } = await loadFixture(deployPoolFixture)
			expect(await pool.paused()).to.be.false
		})
	})

	// ──────────────────────────────────────────────
	//  Pool Funding
	// ──────────────────────────────────────────────

	describe('Pool Funding', function () {
		it('Should allow funding the pool', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			const amount = hre.ethers.parseEther('10')

			await expect(pool.connect(alice).fundPool({ value: amount }))
				.to.emit(pool, 'PoolFunded')
				.withArgs(alice.address, amount)

			expect(await pool.totalPoolLiquidity()).to.equal(amount)
			expect(await pool.getAvailableLiquidity()).to.equal(amount)
		})

		it('Should track multiple deposits', async function () {
			const { pool, alice, bob } = await loadFixture(deployPoolFixture)
			const amount1 = hre.ethers.parseEther('10')
			const amount2 = hre.ethers.parseEther('20')

			await pool.connect(alice).fundPool({ value: amount1 })
			await pool.connect(bob).fundPool({ value: amount2 })

			expect(await pool.totalPoolLiquidity()).to.equal(amount1 + amount2)
			expect(await pool.getLenderCount()).to.equal(2)
		})

		it('Should track lender deposit info', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			const amount = hre.ethers.parseEther('10')

			await pool.connect(alice).fundPool({ value: amount })

			const [depositAmount] = await pool.getLenderDeposit(alice.address)
			expect(depositAmount).to.equal(amount)
		})

		it('Should allow multiple deposits from same lender', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			const amount1 = hre.ethers.parseEther('10')
			const amount2 = hre.ethers.parseEther('5')

			await pool.connect(alice).fundPool({ value: amount1 })
			await pool.connect(alice).fundPool({ value: amount2 })

			const [depositAmount] = await pool.getLenderDeposit(alice.address)
			expect(depositAmount).to.equal(amount1 + amount2)
		})

		it('Should revert if below minimum deposit', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await expect(
				pool.connect(alice).fundPool({ value: 0 })
			).to.be.reverted
		})
	})

	// ──────────────────────────────────────────────
	//  Pool Withdrawal
	// ──────────────────────────────────────────────

	describe('Pool Withdrawal', function () {
		it('Should allow withdrawing deposited funds', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			const deposit = hre.ethers.parseEther('10')
			const withdraw = hre.ethers.parseEther('5')

			await pool.connect(alice).fundPool({ value: deposit })

			await expect(pool.connect(alice).withdrawFunds(withdraw))
				.to.emit(pool, 'PoolWithdrawn')

			expect(await pool.totalPoolLiquidity()).to.equal(deposit - withdraw)
		})

		it('Should revert withdrawal exceeding deposit', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await pool.connect(alice).fundPool({ value: hre.ethers.parseEther('10') })

			await expect(
				pool.connect(alice).withdrawFunds(hre.ethers.parseEther('20'))
			).to.be.revertedWithCustomError(pool, 'WithdrawalExceedsDeposit')
		})

		it('Should revert withdrawal from non-lender', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await expect(
				pool.connect(alice).withdrawFunds(hre.ethers.parseEther('1'))
			).to.be.revertedWithCustomError(pool, 'NotLender')
		})
	})

	// ──────────────────────────────────────────────
	//  Loan Requests
	// ──────────────────────────────────────────────

	describe('Loan Requests', function () {
		it('Should request a loan', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await expect(pool.connect(alice).requestLoan(hre.ethers.parseEther('5'), 0, 1))
				.to.emit(pool, 'LoanRequested')

			expect(await pool.loanCount()).to.equal(1)
		})

		it('Should track borrower loans', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await pool.connect(alice).requestLoan(hre.ethers.parseEther('1'), 0, 1)

			const loans = await pool.getBorrowerLoans(alice.address)
			expect(loans.length).to.equal(1)
		})

		it('Should auto-approve when no credit engine set', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await pool.connect(alice).requestLoan(hre.ethers.parseEther('1'), 0, 1)

			expect(await pool.getLoanStatus(0)).to.equal(1) // Active (auto-approved)
		})

		it('Should allow multiple loan requests', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('100'))

			await pool.connect(alice).requestLoan(hre.ethers.parseEther('1'), 0, 1)
			await pool.connect(alice).requestLoan(hre.ethers.parseEther('2'), 0, 0)

			expect(await pool.loanCount()).to.equal(2)
			const loans = await pool.getBorrowerLoans(alice.address)
			expect(loans.length).to.equal(2)
		})
	})

	// ──────────────────────────────────────────────
	//  Repayment
	// ──────────────────────────────────────────────

	describe('Repayment', function () {
		it('Should accept repayment', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))
			await pool.connect(alice).requestLoan(hre.ethers.parseEther('1'), 0, 1)

			const repayAmount = hre.ethers.parseEther('0.1')
			await expect(pool.connect(alice).repayLoan(0, { value: repayAmount }))
				.to.emit(pool, 'RepaymentMade')
				.withArgs(alice.address, 0, repayAmount)
		})

		it('Should revert repayment from non-borrower', async function () {
			const { pool, alice, bob } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))
			await pool.connect(alice).requestLoan(hre.ethers.parseEther('1'), 0, 1)

			await expect(
				pool.connect(bob).repayLoan(0, { value: hre.ethers.parseEther('0.1') })
			).to.be.revertedWithCustomError(pool, 'NotBorrower')
		})

		it('Should revert repayment of zero amount', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))
			await pool.connect(alice).requestLoan(hre.ethers.parseEther('1'), 0, 1)

			await expect(pool.connect(alice).repayLoan(0, { value: 0 })).to.be.reverted
		})

		it('Should revert repayment on non-active loan', async function () {
			const { pool, creditEngine, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))
			await pool.connect(owner).setCreditEngine(await creditEngine.getAddress())

			// Alice has no credit score, so loan stays Pending
			await pool.connect(alice).requestLoan(hre.ethers.parseEther('1'), 0, 1)

			await expect(
				pool.connect(alice).repayLoan(0, { value: hre.ethers.parseEther('0.1') })
			).to.be.revertedWithCustomError(pool, 'LoanNotActive')
		})

		it('Should increase repaid amount on partial repayment', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))
			await pool.connect(alice).requestLoan(hre.ethers.parseEther('1'), 0, 1)

			await pool.connect(alice).repayLoan(0, { value: hre.ethers.parseEther('0.3') })

			const [, , , repaid] = await pool.getLoan(0)
			expect(repaid).to.equal(hre.ethers.parseEther('0.3'))
		})
	})

	// ──────────────────────────────────────────────
	//  Default
	// ──────────────────────────────────────────────

	describe('Default', function () {
		it('Should mark loan as defaulted', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))
			await pool.connect(alice).requestLoan(hre.ethers.parseEther('1'), 0, 1)

			await expect(pool.connect(owner).markDefaulted(0))
				.to.emit(pool, 'LoanDefaulted')

			expect(await pool.getLoanStatus(0)).to.equal(3) // Defaulted
		})

		it('Should not allow non-owner to mark defaulted', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))
			await pool.connect(alice).requestLoan(hre.ethers.parseEther('1'), 0, 1)

			await expect(
				pool.connect(alice).markDefaulted(0)
			).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount')
		})

		it('Should revert for non-existent loan', async function () {
			const { pool, owner } = await loadFixture(deployPoolFixture)
			await expect(
				pool.connect(owner).markDefaulted(999)
			).to.be.revertedWithCustomError(pool, 'LoanNotFound')
		})
	})

	// ──────────────────────────────────────────────
	//  Read-Only Queries
	// ──────────────────────────────────────────────

	describe('Read-Only Queries', function () {
		it('Should revert loan query for invalid ID', async function () {
			const { pool } = await loadFixture(deployPoolFixture)
			await expect(pool.getLoanStatus(999)).to.be.revertedWithCustomError(pool, 'LoanNotFound')
		})

		it('Should return lender count', async function () {
			const { pool, alice, bob } = await loadFixture(deployPoolFixture)
			expect(await pool.getLenderCount()).to.equal(0)

			await fundPool(pool, alice, hre.ethers.parseEther('10'))
			expect(await pool.getLenderCount()).to.equal(1)

			await fundPool(pool, bob, hre.ethers.parseEther('5'))
			expect(await pool.getLenderCount()).to.equal(2)
		})

		it('Should return lender by index', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('10'))

			expect(await pool.getLenderAtIndex(0)).to.equal(alice.address)
		})
	})

	// ──────────────────────────────────────────────
	//  Admin Functions
	// ──────────────────────────────────────────────

	describe('Admin Functions', function () {
		it('Should set credit engine', async function () {
			const { pool, owner, creditEngine } = await loadFixture(deployPoolFixture)
			const engineAddr = await creditEngine.getAddress()
			await expect(pool.connect(owner).setCreditEngine(engineAddr))
				.to.emit(pool, 'CreditEngineSet')
				.withArgs(engineAddr)

			expect(await pool.creditEngine()).to.equal(engineAddr)
		})

		it('Should pause and unpause', async function () {
			const { pool, owner } = await loadFixture(deployPoolFixture)

			await pool.connect(owner).setPaused(true)
			expect(await pool.paused()).to.be.true

			await pool.connect(owner).setPaused(false)
			expect(await pool.paused()).to.be.false
		})

		it('Should revert funding when paused', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await pool.connect(owner).setPaused(true)

			await expect(
				pool.connect(alice).fundPool({ value: hre.ethers.parseEther('10') })
			).to.be.revertedWithCustomError(pool, 'PoolPaused')
		})
	})

	// ──────────────────────────────────────────────
	//  Full Flow Integration
	// ──────────────────────────────────────────────

	describe('Full Flow', function () {
		it('Should complete full lending lifecycle', async function () {
			const { pool, alice, bob } = await loadFixture(deployPoolFixture)

			// 1. Alice funds pool
			await fundPool(pool, alice, hre.ethers.parseEther('50'))
			expect(await pool.totalPoolLiquidity()).to.equal(hre.ethers.parseEther('50'))

			// 2. Bob requests a loan -> auto-approves (no credit engine)
			await expect(pool.connect(bob).requestLoan(hre.ethers.parseEther('5'), 0, 1))
				.to.emit(pool, 'LoanApproved')

			expect(await pool.getLoanStatus(0)).to.equal(1) // Active

			// 3. Bob repays partially
			await pool.connect(bob).repayLoan(0, { value: hre.ethers.parseEther('0.5') })

			// 4. Verify pool state
			expect(await pool.getLenderCount()).to.equal(1)
			expect(await pool.loanCount()).to.equal(1)

			const [, , , repaid] = await pool.getLoan(0)
			expect(repaid).to.equal(hre.ethers.parseEther('0.5'))
		})
	})
})
