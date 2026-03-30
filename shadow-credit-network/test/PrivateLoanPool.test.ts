import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { expect } from 'chai'

describe('PrivateLoanPool', function () {
	async function deployPoolFixture() {
		const [owner, alice, bob, charlie, feeReceiver] = await hre.ethers.getSigners()

		const PrivateLoanPool = await hre.ethers.getContractFactory('PrivateLoanPool')
		const pool = await PrivateLoanPool.connect(owner).deploy(owner.address, feeReceiver.address)

		return { pool, owner, alice, bob, charlie, feeReceiver }
	}

	async function fundPool(pool: any, funder: any, amount: bigint) {
		await pool.connect(funder).fundPool({ value: amount })
	}

	async function requestLoan(pool: any, borrower: any, principal: bigint, duration: number, riskPool: number) {
		await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(borrower))
		const [encPrincipal] = await hre.cofhe.expectResultSuccess(
			cofhejs.encrypt([Encryptable.uint64(principal)] as const)
		)
		const [encDuration] = await hre.cofhe.expectResultSuccess(
			cofhejs.encrypt([Encryptable.uint32(BigInt(duration))] as const)
		)
		return pool.connect(borrower).requestLoan(encPrincipal, encDuration, riskPool)
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

		it('Should set the correct fee receiver', async function () {
			const { pool, feeReceiver } = await loadFixture(deployPoolFixture)
			expect(await pool.feeReceiver()).to.equal(feeReceiver.address)
		})

		it('Should set default pool parameters', async function () {
			const { pool } = await loadFixture(deployPoolFixture)
			expect(await pool.minLoanAmount()).to.equal(hre.ethers.parseEther('0.01'))
			expect(await pool.maxLoanAmount()).to.equal(hre.ethers.parseEther('100'))
			expect(await pool.protocolFee()).to.equal(50) // 0.5%
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
			const balanceBefore = await hre.ethers.provider.getBalance(alice.address)

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

			await expect(requestLoan(pool, alice, hre.ethers.parseEther('5').valueOf(), 90 * 86400, 1))
				.to.emit(pool, 'LoanRequested')

			expect(await pool.loanCount()).to.equal(1)
		})

		it('Should track borrower loans', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)

			const loans = await pool.getBorrowerLoans(alice.address)
			expect(loans.length).to.equal(1)
		})

		it('Should set loan status to Pending', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)

			expect(await pool.getLoanStatus(0)).to.equal(0) // Pending
		})

		it('Should allow multiple loan requests', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('100'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)
			await requestLoan(pool, alice, hre.ethers.parseEther('2').valueOf(), 180 * 86400, 0)

			expect(await pool.loanCount()).to.equal(2)
			const loans = await pool.getBorrowerLoans(alice.address)
			expect(loans.length).to.equal(2)
		})
	})

	// ──────────────────────────────────────────────
	//  Loan Approval
	// ──────────────────────────────────────────────

	describe('Loan Approval', function () {
		it('Should approve a pending loan', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)

			await expect(pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1')))
				.to.emit(pool, 'LoanApproved')

			expect(await pool.getLoanStatus(0)).to.equal(1) // Active
		})

		it('Should reject a pending loan', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)

			await expect(pool.connect(owner).rejectLoan(0))
				.to.emit(pool, 'LoanRejected')
		})

		it('Should revert approval from non-owner', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)

			await expect(pool.connect(alice).approveLoan(0, hre.ethers.parseEther('1'))).to.be.revertedWithCustomError(
				pool,
				'OwnableUnauthorizedAccount'
			)
		})

		it('Should revert approval of invalid loan ID', async function () {
			const { pool, owner } = await loadFixture(deployPoolFixture)
			await expect(pool.connect(owner).approveLoan(999, hre.ethers.parseEther('1'))).to.be.revertedWithCustomError(
				pool,
				'LoanNotFound'
			)
		})

		it('Should disburse ETH to borrower on approval', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)

			const balanceBefore = await hre.ethers.provider.getBalance(alice.address)
			await pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1'))
			const balanceAfter = await hre.ethers.provider.getBalance(alice.address)

			expect(balanceAfter).to.be.gt(balanceBefore)
		})
	})

	// ──────────────────────────────────────────────
	//  Repayment
	// ──────────────────────────────────────────────

	describe('Repayment', function () {
		it('Should accept repayment', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)
			await pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1'))

			const repayAmount = hre.ethers.parseEther('0.1')
			await expect(pool.connect(alice).repayLoan(0, { value: repayAmount }))
				.to.emit(pool, 'RepaymentMade')
				.withArgs(alice.address, 0, repayAmount)
		})

		it('Should revert repayment from non-borrower', async function () {
			const { pool, owner, alice, bob } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)
			await pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1'))

			await expect(
				pool.connect(bob).repayLoan(0, { value: hre.ethers.parseEther('0.1') })
			).to.be.revertedWithCustomError(pool, 'NotBorrower')
		})

		it('Should revert repayment of zero amount', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)
			await pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1'))

			await expect(pool.connect(alice).repayLoan(0, { value: 0 })).to.be.reverted
		})

		it('Should revert repayment on non-active loan', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)

			await expect(
				pool.connect(alice).repayLoan(0, { value: hre.ethers.parseEther('0.1') })
			).to.be.revertedWithCustomError(pool, 'LoanNotActive')
		})

		it('Should mark loan as repaid', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)
			await pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1'))

			await pool.connect(owner).markRepaid(0)
			expect(await pool.getLoanStatus(0)).to.equal(2) // Repaid
		})
	})

	// ──────────────────────────────────────────────
	//  Default & Liquidation
	// ──────────────────────────────────────────────

	describe('Default & Liquidation', function () {
		it('Should mark loan as defaulted after due date', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)
			await pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1'))

			// Fast forward past due date (Moderate: 180 days max + 1)
			await time.increase(181 * 86400)

			await expect(pool.connect(owner).markDefaulted(0))
				.to.emit(pool, 'LoanDefaulted')

			expect(await pool.getLoanStatus(0)).to.equal(3) // Defaulted
		})

		it('Should revert default before due date', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)
			await pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1'))

			await expect(pool.connect(owner).markDefaulted(0)).to.be.revertedWithCustomError(
				pool,
				'MinLoanDurationNotMet'
			)
		})

		it('Should liquidate a defaulted loan', async function () {
			const { pool, owner, alice, charlie } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)
			await pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1'))

			await time.increase(181 * 86400)
			await pool.connect(owner).markDefaulted(0)

			await expect(pool.connect(charlie).liquidateLoan(0))
				.to.emit(pool, 'LoanLiquidated')

			expect(await pool.getLoanStatus(0)).to.equal(4) // Liquidated
		})

		it('Should revert liquidation of non-defaulted loan', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('50'))

			await requestLoan(pool, alice, hre.ethers.parseEther('1').valueOf(), 90 * 86400, 1)
			await pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1'))

			await expect(pool.connect(alice).liquidateLoan(0)).to.be.revertedWithCustomError(
				pool,
				'LoanNotActive'
			)
		})
	})

	// ──────────────────────────────────────────────
	//  Yield Distribution
	// ──────────────────────────────────────────────

	describe('Yield Distribution', function () {
		it('Should distribute yield to a lender', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await fundPool(pool, alice, hre.ethers.parseEther('10'))

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner))

			const [encYield] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(hre.ethers.parseEther('0.5').valueOf())] as const)
			)

			await expect(pool.connect(owner).distributeYield(alice.address, encYield))
				.to.emit(pool, 'YieldDistributed')
		})

		it('Should revert yield distribution to non-lender', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner))

			const [encYield] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(hre.ethers.parseEther('0.5').valueOf())] as const)
			)

			await expect(
				pool.connect(owner).distributeYield(alice.address, encYield)
			).to.be.revertedWithCustomError(pool, 'NotLender')
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
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await expect(pool.connect(owner).setCreditEngine(alice.address))
				.to.emit(pool, 'CreditEngineSet')
				.withArgs(alice.address)

			expect(await pool.creditEngine()).to.equal(alice.address)
		})

		it('Should update pool parameters', async function () {
			const { pool, owner } = await loadFixture(deployPoolFixture)
			const newMin = hre.ethers.parseEther('0.1')
			const newMax = hre.ethers.parseEther('500')

			await pool.connect(owner).updatePoolParams(newMin, newMax, 100)

			expect(await pool.minLoanAmount()).to.equal(newMin)
			expect(await pool.maxLoanAmount()).to.equal(newMax)
			expect(await pool.protocolFee()).to.equal(100)
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

		it('Should update fee receiver', async function () {
			const { pool, owner, alice } = await loadFixture(deployPoolFixture)
			await pool.connect(owner).setFeeReceiver(alice.address)
			expect(await pool.feeReceiver()).to.equal(alice.address)
		})

		it('Should not allow non-owner to update params', async function () {
			const { pool, alice } = await loadFixture(deployPoolFixture)
			await expect(
				pool.connect(alice).updatePoolParams(0, 0, 0)
			).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount')
		})
	})

	// ──────────────────────────────────────────────
	//  Full Flow Integration
	// ──────────────────────────────────────────────

	describe('Full Flow', function () {
		it('Should complete full lending lifecycle', async function () {
			const { pool, owner, alice, bob } = await loadFixture(deployPoolFixture)

			// 1. Alice funds pool
			await fundPool(pool, alice, hre.ethers.parseEther('50'))
			expect(await pool.totalPoolLiquidity()).to.equal(hre.ethers.parseEther('50'))

			// 2. Bob requests a loan
			await requestLoan(pool, bob, hre.ethers.parseEther('5').valueOf(), 90 * 86400, 1)
			expect(await pool.getLoanStatus(0)).to.equal(0) // Pending

			// 3. Owner approves loan
			await pool.connect(owner).approveLoan(0, hre.ethers.parseEther('1'))
			expect(await pool.getLoanStatus(0)).to.equal(1) // Active

			// 4. Bob repays partially
			await pool.connect(bob).repayLoan(0, { value: hre.ethers.parseEther('0.5') })

			// 5. Owner marks repaid
			await pool.connect(owner).markRepaid(0)
			expect(await pool.getLoanStatus(0)).to.equal(2) // Repaid

			// 6. Distribute yield to Alice
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner))
			const [encYield] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(hre.ethers.parseEther('0.1').valueOf())] as const)
			)
			await pool.connect(owner).distributeYield(alice.address, encYield)

			// 7. Verify pool state
			expect(await pool.getLenderCount()).to.equal(1)
			expect(await pool.loanCount()).to.equal(1)
		})
	})
})
