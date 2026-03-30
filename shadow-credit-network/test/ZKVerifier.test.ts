import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { expect } from 'chai'

describe('ZKVerifier + CreditDataWithZK', function () {
	async function deployFixture() {
		const [owner, alice, bob] = await hre.ethers.getSigners()

		// Deploy Groth16Verifier
		const Groth16Verifier = await hre.ethers.getContractFactory('Groth16Verifier')
		const verifier = await Groth16Verifier.connect(owner).deploy()

		// Deploy CreditDataWithZK
		const CreditDataWithZK = await hre.ethers.getContractFactory('CreditDataWithZK')
		const zkBridge = await CreditDataWithZK.connect(owner).deploy(owner.address)

		// Deploy EncryptedCreditEngine
		const EncryptedCreditEngine = await hre.ethers.getContractFactory('EncryptedCreditEngine')
		const engine = await EncryptedCreditEngine.connect(owner).deploy(owner.address)

		return { verifier, zkBridge, engine, owner, alice, bob }
	}

	// BN256 test vectors for verification key
	// These are valid BN256 curve points for testing
	const ALPHA = [
		1n,
		2n
	]
	const BETA = [
		[1n, 2n],
		[1n, 2n]
	]
	const GAMMA = [
		[1n, 2n],
		[1n, 2n]
	]
	const DELTA = [
		[1n, 2n],
		[1n, 2n]
	]
	const IC_X = [1n, 1n, 1n]
	const IC_Y = [2n, 2n, 2n]

	beforeEach(function () {
		if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
	})

	afterEach(function () {
		if (!hre.cofhe.isPermittedEnvironment('MOCK')) return
	})

	// ──────────────────────────────────────────────
	//  Groth16Verifier
	// ──────────────────────────────────────────────

	describe('Groth16Verifier', function () {
		it('Should return proof system type', async function () {
			const { verifier } = await loadFixture(deployFixture)
			expect(await verifier.proofSystemType()).to.equal('groth16')
		})

		it('Should register a verification key', async function () {
			const { verifier } = await loadFixture(deployFixture)
			const vkHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('test-vk'))

			await verifier.registerVerificationKey(
				vkHash,
				ALPHA,
				BETA,
				GAMMA,
				DELTA,
				IC_X,
				IC_Y
			)

			expect(await verifier.hasVerificationKey(vkHash)).to.be.true
			expect(await verifier.getVerificationKeyCount()).to.equal(1)
			expect(await verifier.getVerificationKeyHash(0)).to.equal(vkHash)
		})

		it('Should report public input count from IC length', async function () {
			const { verifier } = await loadFixture(deployFixture)
			const vkHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('test-vk'))

			await verifier.registerVerificationKey(
				vkHash,
				ALPHA,
				BETA,
				GAMMA,
				DELTA,
				IC_X,
				IC_Y
			)

			// IC has 3 points, so public input count = 3 - 1 = 2
			expect(await verifier.getPublicInputCount(vkHash)).to.equal(2)
		})

		it('Should remove a verification key', async function () {
			const { verifier } = await loadFixture(deployFixture)
			const vkHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('test-vk'))

			await verifier.registerVerificationKey(
				vkHash,
				ALPHA,
				BETA,
				GAMMA,
				DELTA,
				IC_X,
				IC_Y
			)

			await verifier.removeVerificationKey(vkHash)
			expect(await verifier.hasVerificationKey(vkHash)).to.be.false
		})

		it('Should revert removing non-existent VK', async function () {
			const { verifier } = await loadFixture(deployFixture)
			const vkHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('nonexistent'))

			await expect(verifier.removeVerificationKey(vkHash)).to.be.revertedWithCustomError(
				verifier,
				'VerificationKeyNotFound'
			)
		})

		it('Should revert verifyProof when no VK registered', async function () {
			const { verifier } = await loadFixture(deployFixture)

			await expect(
				verifier.verifyProof('0x', [1n])
			).to.be.revertedWithCustomError(verifier, 'VerificationKeyNotFound')
		})

		it('Should revert verifyProofWithVK for non-existent VK', async function () {
			const { verifier } = await loadFixture(deployFixture)
			const vkHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('nonexistent'))

			await expect(
				verifier.verifyProofWithVK(vkHash, '0x', [1n])
			).to.be.revertedWithCustomError(verifier, 'VerificationKeyNotFound')
		})

		it('Should revert verifyProofWithVK with wrong public input count', async function () {
			const { verifier } = await loadFixture(deployFixture)
			const vkHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('test-vk'))

			await verifier.registerVerificationKey(
				vkHash,
				ALPHA,
				BETA,
				GAMMA,
				DELTA,
				IC_X,
				IC_Y
			)

			// VK expects 2 public inputs, we pass 3
			// Create a dummy 192-byte proof
			const dummyProof = '0x' + '01'.repeat(192)

			await expect(
				verifier.verifyProofWithVK(vkHash, dummyProof, [1n, 2n, 3n])
			).to.be.revertedWithCustomError(verifier, 'InvalidPublicInputCount')
		})
	})

	// ──────────────────────────────────────────────
	//  CreditDataWithZK
	// ──────────────────────────────────────────────

	describe('CreditDataWithZK', function () {
		it('Should set the owner', async function () {
			const { zkBridge, owner } = await loadFixture(deployFixture)
			expect(await zkBridge.owner()).to.equal(owner.address)
		})

		it('Should set the verifier', async function () {
			const { zkBridge, verifier, owner } = await loadFixture(deployFixture)
			await zkBridge.connect(owner).setVerifier(await verifier.getAddress())

			expect(await zkBridge.verifier()).to.equal(await verifier.getAddress())
		})

		it('Should set the credit engine', async function () {
			const { zkBridge, engine, owner } = await loadFixture(deployFixture)
			await zkBridge.connect(owner).setCreditEngine(await engine.getAddress())

			expect(await zkBridge.creditEngine()).to.equal(await engine.getAddress())
		})

		it('Should track used nonces', async function () {
			const { zkBridge, alice } = await loadFixture(deployFixture)
			expect(await zkBridge.isNonceUsed(alice.address, 1)).to.be.false
		})

		it('Should revert if verifier not set for verification', async function () {
			const { zkBridge } = await loadFixture(deployFixture)

			await expect(
				zkBridge.verifyOnly('0x', [1n], hre.ethers.ZeroHash)
			).to.be.revertedWithCustomError(zkBridge, 'VerifierNotSet')
		})

		it('Should revert submitWithProof if not registered', async function () {
			const { zkBridge, verifier, engine, owner, alice } = await loadFixture(deployFixture)
			await zkBridge.connect(owner).setVerifier(await verifier.getAddress())
			await zkBridge.connect(owner).setCreditEngine(await engine.getAddress())

			// Alice is not registered in the engine
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))
			const [enc] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(100n)] as const)
			)
			const [enc32] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(100n)] as const)
			)

			await expect(
				zkBridge.connect(alice).submitWithProof(
					'0x' + '01'.repeat(192),
					[1n, 2n],
					hre.ethers.ZeroHash,
					1,
					enc, enc, enc32, enc32, enc32, enc32
				)
			).to.be.revertedWithCustomError(zkBridge, 'NotRegistered')
		})

		it('Should allow non-owner to not set params', async function () {
			const { zkBridge, alice } = await loadFixture(deployFixture)

			await expect(
				zkBridge.connect(alice).setVerifier(alice.address)
			).to.be.revertedWith('Not owner')
		})

		it('Should transfer ownership', async function () {
			const { zkBridge, owner, alice } = await loadFixture(deployFixture)
			await zkBridge.connect(owner).transferOwnership(alice.address)
			expect(await zkBridge.owner()).to.equal(alice.address)
		})

		it('Should set max proof age', async function () {
			const { zkBridge, owner } = await loadFixture(deployFixture)
			await zkBridge.connect(owner).setMaxProofAge(7200)
			expect(await zkBridge.maxProofAge()).to.equal(7200)
		})
	})

	// ──────────────────────────────────────────────
	//  Integration Flow (Mocked)
	// ──────────────────────────────────────────────

	describe('Integration Flow', function () {
		it('Should complete the verifier + bridge setup', async function () {
			const { verifier, zkBridge, engine, owner, alice } = await loadFixture(deployFixture)

			// 1. Register a VK
			const vkHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('credit-data-vk'))
			await verifier.registerVerificationKey(
				vkHash,
				ALPHA, BETA, GAMMA, DELTA,
				IC_X, IC_Y
			)
			expect(await verifier.hasVerificationKey(vkHash)).to.be.true

			// 2. Configure bridge
			await zkBridge.connect(owner).setVerifier(await verifier.getAddress())
			await zkBridge.connect(owner).setCreditEngine(await engine.getAddress())

			// 3. Register Alice in the engine
			await engine.connect(alice).register()
			expect(await engine.isRegistered(alice.address)).to.be.true

			// 4. Verify bridge configuration
			expect(await zkBridge.verifier()).to.equal(await verifier.getAddress())
			expect(await zkBridge.creditEngine()).to.equal(await engine.getAddress())
		})
	})
})
