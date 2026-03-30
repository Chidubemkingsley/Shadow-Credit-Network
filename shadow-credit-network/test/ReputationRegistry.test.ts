import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { expect } from 'chai'

describe('ReputationRegistry', function () {
	const DECAY_INTERVAL = 90 * 24 * 60 * 60 // 90 days in seconds

	async function deployRegistryFixture() {
		const [owner, alice, bob, charlie, verifier1, verifier2, integration] =
			await hre.ethers.getSigners()

		const ReputationRegistry = await hre.ethers.getContractFactory('ReputationRegistry')
		const registry = await ReputationRegistry.connect(owner).deploy(
			owner.address,
			DECAY_INTERVAL,
			2 // min attestations
		)

		return { registry, owner, alice, bob, charlie, verifier1, verifier2, integration }
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
			const { registry, owner } = await loadFixture(deployRegistryFixture)
			expect(await registry.owner()).to.equal(owner.address)
		})

		it('Should set decay interval', async function () {
			const { registry } = await loadFixture(deployRegistryFixture)
			expect(await registry.decayInterval()).to.equal(DECAY_INTERVAL)
		})

		it('Should set min attestations', async function () {
			const { registry } = await loadFixture(deployRegistryFixture)
			expect(await registry.minAttestations()).to.equal(2)
		})
	})

	// ──────────────────────────────────────────────
	//  Registration
	// ──────────────────────────────────────────────

	describe('Registration', function () {
		it('Should register a new user', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await expect(registry.connect(alice).register())
				.to.emit(registry, 'UserRegistered')
				.withArgs(alice.address)

			expect(await registry.isRegistered(alice.address)).to.be.true
		})

		it('Should increment user count', async function () {
			const { registry, alice, bob } = await loadFixture(deployRegistryFixture)
			expect(await registry.getUserCount()).to.equal(0)

			await registry.connect(alice).register()
			expect(await registry.getUserCount()).to.equal(1)

			await registry.connect(bob).register()
			expect(await registry.getUserCount()).to.equal(2)
		})

		it('Should store user in index', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await registry.connect(alice).register()
			expect(await registry.getUserAtIndex(0)).to.equal(alice.address)
		})

		it('Should set registration timestamp', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await registry.connect(alice).register()
			const registeredAt = await registry.getRegisteredAt(alice.address)
			expect(registeredAt).to.be.gt(0)
		})

		it('Should revert if already registered', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await registry.connect(alice).register()
			await expect(registry.connect(alice).register()).to.be.revertedWithCustomError(
				registry,
				'AlreadyRegistered'
			)
		})
	})

	// ──────────────────────────────────────────────
	//  Verifier Management
	// ──────────────────────────────────────────────

	describe('Verifier Management', function () {
		it('Should add a verifier', async function () {
			const { registry, owner, verifier1 } = await loadFixture(deployRegistryFixture)
			await expect(registry.connect(owner).addVerifier(verifier1.address))
				.to.emit(registry, 'VerifierAdded')
				.withArgs(verifier1.address)

			expect(await registry.verifiers(verifier1.address)).to.be.true
			expect(await registry.getVerifierCount()).to.equal(1)
		})

		it('Should remove a verifier', async function () {
			const { registry, owner, verifier1 } = await loadFixture(deployRegistryFixture)
			await registry.connect(owner).addVerifier(verifier1.address)

			await expect(registry.connect(owner).removeVerifier(verifier1.address))
				.to.emit(registry, 'VerifierRemoved')
				.withArgs(verifier1.address)

			expect(await registry.verifiers(verifier1.address)).to.be.false
		})

		it('Should not allow non-owner to add verifier', async function () {
			const { registry, alice, verifier1 } = await loadFixture(deployRegistryFixture)
			await expect(
			 registry.connect(alice).addVerifier(verifier1.address)
			).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount')
		})

		it('Should revert adding already existing verifier', async function () {
			const { registry, owner, verifier1 } = await loadFixture(deployRegistryFixture)
			await registry.connect(owner).addVerifier(verifier1.address)
			await expect(
			 registry.connect(owner).addVerifier(verifier1.address)
			).to.be.revertedWithCustomError(registry, 'AlreadyVerifier')
		})

		it('Should revert removing non-existent verifier', async function () {
			const { registry, owner, verifier1 } = await loadFixture(deployRegistryFixture)
			await expect(
			 registry.connect(owner).removeVerifier(verifier1.address)
			).to.be.revertedWithCustomError(registry, 'NotVerifier')
		})
	})

	// ──────────────────────────────────────────────
	//  Integration Contracts
	// ──────────────────────────────────────────────

	describe('Integration Contracts', function () {
		it('Should set an integration contract', async function () {
			const { registry, owner, integration } = await loadFixture(deployRegistryFixture)
			await expect(registry.connect(owner).setIntegrationContract(integration.address))
				.to.emit(registry, 'IntegrationContractSet')
				.withArgs(integration.address)

			expect(await registry.integrationContracts(integration.address)).to.be.true
		})

		it('Should remove an integration contract', async function () {
			const { registry, owner, integration } = await loadFixture(deployRegistryFixture)
			await registry.connect(owner).setIntegrationContract(integration.address)

			await expect(registry.connect(owner).removeIntegrationContract(integration.address))
				.to.emit(registry, 'IntegrationContractRemoved')
				.withArgs(integration.address)

			expect(await registry.integrationContracts(integration.address)).to.be.false
		})

		it('Should not allow non-owner to set integration', async function () {
			const { registry, alice, integration } = await loadFixture(deployRegistryFixture)
			await expect(
			 registry.connect(alice).setIntegrationContract(integration.address)
			).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount')
		})
	})

	// ──────────────────────────────────────────────
	//  Reputation Updates (Integration Contract)
	// ──────────────────────────────────────────────

	describe('Reputation Updates', function () {
		async function setupWithIntegration(
			registry: any,
			owner: any,
			alice: any,
			integration: any
		) {
			await registry.connect(owner).setIntegrationContract(integration.address)
			await registry.connect(alice).register()
		}

		it('Should update a reputation factor via integration contract', async function () {
			const { registry, owner, alice, integration } = await loadFixture(deployRegistryFixture)
			await setupWithIntegration(registry, owner, alice, integration)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(integration))

			const [encScore] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(8500n)] as const)
			)

			await expect(
				registry
					.connect(integration)
					.updateReputation(alice.address, 0, encScore) // TransactionReliability = 0
			).to.emit(registry, 'ReputationUpdated')
		})

		it('Should batch update reputation factors', async function () {
			const { registry, owner, alice, integration } = await loadFixture(deployRegistryFixture)
			await setupWithIntegration(registry, owner, alice, integration)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(integration))

			const [encScore1] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(8000n)] as const)
			)
			const [encScore2] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(7000n)] as const)
			)

			await registry.connect(integration).batchUpdateReputation(
				alice.address,
				[0, 1], // TransactionReliability, StakingHistory
				[encScore1, encScore2]
			)
		})

		it('Should revert update from non-integration contract', async function () {
			const { registry, alice, bob } = await loadFixture(deployRegistryFixture)
			await registry.connect(alice).register()

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(bob))

			const [encScore] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(8500n)] as const)
			)

			await expect(
				registry.connect(bob).updateReputation(alice.address, 0, encScore)
			).to.be.revertedWithCustomError(registry, 'NotIntegrationContract')
		})
	})

	// ──────────────────────────────────────────────
	//  Attestations
	// ──────────────────────────────────────────────

	describe('Attestations', function () {
		async function setupWithVerifier(
			registry: any,
			owner: any,
			alice: any,
			verifier1: any
		) {
			await registry.connect(owner).addVerifier(verifier1.address)
			await registry.connect(alice).register()
		}

		it('Should submit an attestation', async function () {
			const { registry, owner, alice, verifier1 } = await loadFixture(deployRegistryFixture)
			await setupWithVerifier(registry, owner, alice, verifier1)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(verifier1))

			const [encScore] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9000n)] as const)
			)

			await expect(
				registry
					.connect(verifier1)
					.submitAttestation(alice.address, 0, encScore) // Identity = 0
			)
				.to.emit(registry, 'AttestationSubmitted')
				.withArgs(alice.address, verifier1.address, 0)
		})

		it('Should revoke an attestation', async function () {
			const { registry, owner, alice, verifier1 } = await loadFixture(deployRegistryFixture)
			await setupWithVerifier(registry, owner, alice, verifier1)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(verifier1))

			const [encScore] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9000n)] as const)
			)

			await registry.connect(verifier1).submitAttestation(alice.address, 0, encScore)

			await expect(
				registry.connect(verifier1).revokeAttestation(alice.address, 0)
			)
				.to.emit(registry, 'AttestationRevoked')
				.withArgs(alice.address, verifier1.address, 0)

			expect(
				await registry.isAttestationActive(alice.address, verifier1.address, 0)
			).to.be.false
		})

		it('Should count active attestations', async function () {
			const { registry, owner, alice, verifier1, verifier2 } =
				await loadFixture(deployRegistryFixture)
			await registry.connect(owner).addVerifier(verifier1.address)
			await registry.connect(owner).addVerifier(verifier2.address)
			await registry.connect(alice).register()

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(verifier1))
			const [encScore] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9000n)] as const)
			)

			await registry.connect(verifier1).submitAttestation(alice.address, 0, encScore)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(verifier2))
			const [encScore2] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(8500n)] as const)
			)
			await registry.connect(verifier2).submitAttestation(alice.address, 1, encScore2)

			expect(await registry.getActiveAttestationCount(alice.address)).to.equal(2)
		})

		it('Should revert non-verifier attestation', async function () {
			const { registry, alice, bob } = await loadFixture(deployRegistryFixture)
			await registry.connect(alice).register()

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(bob))

			const [encScore] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9000n)] as const)
			)

			await expect(
				registry.connect(bob).submitAttestation(alice.address, 0, encScore)
			).to.be.revertedWithCustomError(registry, 'NotVerifier')
		})

		it('Should revert duplicate attestation of same type', async function () {
			const { registry, owner, alice, verifier1 } = await loadFixture(deployRegistryFixture)
			await setupWithVerifier(registry, owner, alice, verifier1)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(verifier1))

			const [encScore] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9000n)] as const)
			)

			await registry.connect(verifier1).submitAttestation(alice.address, 0, encScore)

			await expect(
				registry.connect(verifier1).submitAttestation(alice.address, 0, encScore)
			).to.be.revertedWithCustomError(registry, 'AlreadyAttested')
		})

		it('Should revert attestation for unregistered user', async function () {
			const { registry, owner, alice, verifier1 } = await loadFixture(deployRegistryFixture)
			await registry.connect(owner).addVerifier(verifier1.address)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(verifier1))

			const [encScore] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9000n)] as const)
			)

			await expect(
				registry.connect(verifier1).submitAttestation(alice.address, 0, encScore)
			).to.be.revertedWithCustomError(registry, 'NotRegistered')
		})
	})

	// ──────────────────────────────────────────────
	//  Composite Score
	// ──────────────────────────────────────────────

	describe('Composite Score', function () {
		it('Should have initial neutral score of 5000', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await registry.connect(alice).register()

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))

			const scoreHash = await registry.getCompositeScore(alice.address)
			const unsealed = await cofhejs.unseal(scoreHash, FheTypes.Uint32)
			await hre.cofhe.expectResultValue(unsealed, 5000n)
		})

		it('Should recompute composite after reputation update', async function () {
			const { registry, owner, alice, integration } = await loadFixture(deployRegistryFixture)
			await registry.connect(owner).setIntegrationContract(integration.address)
			await registry.connect(alice).register()

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(integration))

			const [encScore] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9000n)] as const)
			)

			await registry.connect(integration).updateReputation(alice.address, 0, encScore)

			// Verify composite has changed from 5000
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))
			const scoreHash = await registry.getCompositeScore(alice.address)
			const unsealed = await cofhejs.unseal(scoreHash, FheTypes.Uint32)
			// Should be higher than 5000 now since TransactionReliability went up
			expect(Number(unsealed.data)).to.be.gt(5000)
		})
	})

	// ──────────────────────────────────────────────
	//  Decryption
	// ──────────────────────────────────────────────

	describe('Decryption', function () {
		it('Should request and retrieve decrypted score', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await registry.connect(alice).register()

			await registry.connect(alice).requestDecryption()

			const [score, isDecrypted] = await registry.connect(alice).getDecryptedScoreSafe()
			if (isDecrypted) {
				expect(score).to.be.gte(0)
				expect(score).to.be.lte(10000)
			}
		})
	})

	// ──────────────────────────────────────────────
	//  Decay Mechanism
	// ──────────────────────────────────────────────

	describe('Decay Mechanism', function () {
		it('Should revert decay if interval not elapsed', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await registry.connect(alice).register()

			await expect(
				registry.applyDecay(alice.address)
			).to.be.revertedWithCustomError(registry, 'DecayNotReady')
		})

		it('Should apply decay after interval', async function () {
			const { registry, owner, alice, integration } = await loadFixture(deployRegistryFixture)
			await registry.connect(owner).setIntegrationContract(integration.address)
			await registry.connect(alice).register()

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(integration))

			const [encScore] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9000n)] as const)
			)

			await registry.connect(integration).updateReputation(alice.address, 0, encScore)

			// Fast forward past decay interval
			await time.increase(DECAY_INTERVAL + 1)

			await expect(registry.applyDecay(alice.address)).to.emit(registry, 'DecayApplied')
		})
	})

	// ──────────────────────────────────────────────
	//  Admin Functions
	// ──────────────────────────────────────────────

	describe('Admin Functions', function () {
		it('Should update decay parameters', async function () {
			const { registry, owner } = await loadFixture(deployRegistryFixture)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(owner))

			const [encRate] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(200n)] as const)
			)

			await registry.connect(owner).updateDecayParams(30 * 24 * 60 * 60, encRate) // 30 days
		})

		it('Should update min attestations', async function () {
			const { registry, owner } = await loadFixture(deployRegistryFixture)
			await registry.connect(owner).setMinAttestations(3)
			expect(await registry.minAttestations()).to.equal(3)
		})

		it('Should not allow non-owner to update parameters', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await expect(
				registry.connect(alice).setMinAttestations(3)
			).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount')
		})
	})

	// ──────────────────────────────────────────────
	//  Read-Only Queries
	// ──────────────────────────────────────────────

	describe('Read-Only Queries', function () {
		it('Should revert query for unregistered user composite score', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await expect(
				registry.getCompositeScore(alice.address)
			).to.be.revertedWithCustomError(registry, 'NotRegistered')
		})

		it('Should revert query for unregistered user factor score', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await expect(
				registry.getFactorScore(alice.address, 0)
			).to.be.revertedWithCustomError(registry, 'NotRegistered')
		})

		it('Should return factor metadata', async function () {
			const { registry, alice } = await loadFixture(deployRegistryFixture)
			await registry.connect(alice).register()

			const lastUpdated = await registry.getFactorMetadata(alice.address, 0)
			expect(lastUpdated).to.be.gt(0)
		})
	})

	// ──────────────────────────────────────────────
	//  Full Flow Integration
	// ──────────────────────────────────────────────

	describe('Full Flow', function () {
		it('Should complete full reputation lifecycle', async function () {
			const { registry, owner, alice, verifier1, verifier2, integration } =
				await loadFixture(deployRegistryFixture)

			// Setup
			await registry.connect(owner).addVerifier(verifier1.address)
			await registry.connect(owner).addVerifier(verifier2.address)
			await registry.connect(owner).setIntegrationContract(integration.address)

			// 1. Register
			await registry.connect(alice).register()
			expect(await registry.isRegistered(alice.address)).to.be.true

			// 2. Integration contract updates reputation factors
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(integration))

			const [encReliability] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9200n)] as const)
			)
			const [encStaking] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(8500n)] as const)
			)

			await registry.connect(integration).updateReputation(alice.address, 0, encReliability)
			await registry.connect(integration).updateReputation(alice.address, 1, encStaking)

			// 3. Verifiers submit attestations
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(verifier1))
			const [encAttest1] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(9500n)] as const)
			)
			await registry.connect(verifier1).submitAttestation(alice.address, 0, encAttest1)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(verifier2))
			const [encAttest2] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint32(8800n)] as const)
			)
			await registry.connect(verifier2).submitAttestation(alice.address, 1, encAttest2)

			// 4. Verify attestation count
			expect(await registry.getActiveAttestationCount(alice.address)).to.equal(2)

			// 5. Verify composite score is higher than initial 5000
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(alice))
			const scoreHash = await registry.getCompositeScore(alice.address)
			const unsealed = await cofhejs.unseal(scoreHash, FheTypes.Uint32)
			expect(Number(unsealed.data)).to.be.gt(5000)

			// 6. Request decryption
			await registry.connect(alice).requestDecryption()

			// 7. Verify state
			const lastActivity = await registry.getLastActivityAt(alice.address)
			expect(lastActivity).to.be.gt(0)
		})
	})
})
