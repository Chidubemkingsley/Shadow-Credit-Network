import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { expect } from 'chai'

// ──────────────────────────────────────────────────────────────────────────────
//  SoulboundCreditNFT — Wave 4 Test Suite
//
//  Tests run against localcofhe (chain ID 412346).
//  Non-FHE tests (soulbound enforcement, access control) run on any network.
// ──────────────────────────────────────────────────────────────────────────────

describe('SoulboundCreditNFT', function () {

    // ── Fixture: deploy engine + NFT + register alice ──────────────────────

    async function deployFixture() {
        const [owner, alice, bob, charlie] = await hre.ethers.getSigners()

        // Deploy EncryptedCreditEngineV3
        const EngineV3 = await hre.ethers.getContractFactory('EncryptedCreditEngineV3')
        const engine = await EngineV3.connect(owner).deploy(owner.address)
        await engine.waitForDeployment()
        const engineAddr = await engine.getAddress()

        // Deploy SoulboundCreditNFT
        const NFT = await hre.ethers.getContractFactory('SoulboundCreditNFT')
        const nft = await NFT.connect(owner).deploy(owner.address, engineAddr)
        await nft.waitForDeployment()

        return { nft, engine, owner, alice, bob, charlie, engineAddr }
    }

    // ── Helper: register + submit credit data + compute score for a user ───

    async function setupUserWithScore(engine: any, user: any) {
        await engine.connect(user).register()
        await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(user))

        const [encIncome] = await hre.cofhe.expectResultSuccess(
            cofhejs.encrypt([Encryptable.uint64(120_000n)] as const)
        )
        const [encDebt] = await hre.cofhe.expectResultSuccess(
            cofhejs.encrypt([Encryptable.uint64(20_000n)] as const)
        )
        const [encPaymentHistory] = await hre.cofhe.expectResultSuccess(
            cofhejs.encrypt([Encryptable.uint32(9500n)] as const)
        )
        const [encUtilization] = await hre.cofhe.expectResultSuccess(
            cofhejs.encrypt([Encryptable.uint32(2500n)] as const)
        )
        const [encAccountAge] = await hre.cofhe.expectResultSuccess(
            cofhejs.encrypt([Encryptable.uint32(2920n)] as const) // 8 years
        )
        const [encDefaults] = await hre.cofhe.expectResultSuccess(
            cofhejs.encrypt([Encryptable.uint32(0n)] as const)
        )

        await engine.connect(user).submitCreditData(
            encIncome, encDebt, encPaymentHistory,
            encUtilization, encAccountAge, encDefaults
        )
        await engine.connect(user).computeCreditScore()
    }

    // ────────────────────────────────────────────────────────────────────────
    //  Deployment
    // ────────────────────────────────────────────────────────────────────────

    describe('Deployment', function () {

        it('Should set the correct owner', async function () {
            const { nft, owner } = await loadFixture(deployFixture)
            expect(await nft.owner()).to.equal(owner.address)
        })

        it('Should set the correct credit engine', async function () {
            const { nft, engineAddr } = await loadFixture(deployFixture)
            expect(await nft.creditEngine()).to.equal(engineAddr)
        })

        it('Should have correct name and symbol', async function () {
            const { nft } = await loadFixture(deployFixture)
            expect(await nft.name()).to.equal('Shadow Credit Identity')
            expect(await nft.symbol()).to.equal('SCID')
        })

        it('Should start with totalMinted = 0', async function () {
            const { nft } = await loadFixture(deployFixture)
            expect(await nft.totalMinted()).to.equal(0n)
        })

        it('Should deploy without credit engine (zero address)', async function () {
            const [owner] = await hre.ethers.getSigners()
            const NFT = await hre.ethers.getContractFactory('SoulboundCreditNFT')
            const nft = await NFT.connect(owner).deploy(owner.address, hre.ethers.ZeroAddress)
            await nft.waitForDeployment()
            expect(await nft.creditEngine()).to.equal(hre.ethers.ZeroAddress)
        })
    })

    // ────────────────────────────────────────────────────────────────────────
    //  Minting
    // ────────────────────────────────────────────────────────────────────────

    describe('Minting', function () {

        beforeEach(function () {
            if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
        })

        it('Should mint a credit identity NFT for a user with a score', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)

            await expect(nft.connect(alice).mint())
                .to.emit(nft, 'CreditIdentityMinted')
                .withArgs(alice.address, 1n, 0n)  // tier 0 = Unrated (score not publicly decrypted)

            expect(await nft.balanceOf(alice.address)).to.equal(1n)
            expect(await nft.hasIdentity(alice.address)).to.be.true
            expect(await nft.totalMinted()).to.equal(1n)
        })

        it('Should assign token ID 1 to first minter', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()
            expect(await nft.holderToken(alice.address)).to.equal(1n)
        })

        it('Should assign incrementing token IDs', async function () {
            const { nft, engine, alice, bob } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await setupUserWithScore(engine, bob)

            await nft.connect(alice).mint()
            await nft.connect(bob).mint()

            expect(await nft.holderToken(alice.address)).to.equal(1n)
            expect(await nft.holderToken(bob.address)).to.equal(2n)
        })

        it('Should revert if user not registered in credit engine', async function () {
            const { nft, alice } = await loadFixture(deployFixture)
            await expect(nft.connect(alice).mint())
                .to.be.revertedWithCustomError(nft, 'NotRegistered')
        })

        it('Should revert if user has no credit score', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await engine.connect(alice).register()
            await expect(nft.connect(alice).mint())
                .to.be.revertedWithCustomError(nft, 'NoScoreComputed')
        })

        it('Should revert if user tries to mint twice', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()
            await expect(nft.connect(alice).mint())
                .to.be.revertedWithCustomError(nft, 'AlreadyMinted')
        })

        it('Should revert if no credit engine is set', async function () {
            const [owner, alice] = await hre.ethers.getSigners()
            const NFT = await hre.ethers.getContractFactory('SoulboundCreditNFT')
            const nftNoEngine = await NFT.connect(owner).deploy(owner.address, hre.ethers.ZeroAddress)
            await expect(nftNoEngine.connect(alice).mint())
                .to.be.revertedWithCustomError(nftNoEngine, 'NoCreditEngine')
        })
    })

    // ────────────────────────────────────────────────────────────────────────
    //  Soulbound — transfer and approval restrictions
    // ────────────────────────────────────────────────────────────────────────

    describe('Soulbound Enforcement', function () {

        beforeEach(function () {
            if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
        })

        it('Should revert on transferFrom', async function () {
            const { nft, engine, alice, bob } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()
            const tokenId = await nft.holderToken(alice.address)

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, tokenId)
            ).to.be.revertedWithCustomError(nft, 'Soulbound')
        })

        it('Should revert on safeTransferFrom', async function () {
            const { nft, engine, alice, bob } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()
            const tokenId = await nft.holderToken(alice.address)

            await expect(
                nft.connect(alice)['safeTransferFrom(address,address,uint256)'](
                    alice.address, bob.address, tokenId
                )
            ).to.be.revertedWithCustomError(nft, 'Soulbound')
        })

        it('Should revert on approve', async function () {
            const { nft, engine, alice, bob } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()
            const tokenId = await nft.holderToken(alice.address)

            await expect(
                nft.connect(alice).approve(bob.address, tokenId)
            ).to.be.revertedWithCustomError(nft, 'Soulbound')
        })

        it('Should revert on setApprovalForAll', async function () {
            const { nft, alice, bob } = await loadFixture(deployFixture)
            await expect(
                nft.connect(alice).setApprovalForAll(bob.address, true)
            ).to.be.revertedWithCustomError(nft, 'Soulbound')
        })

        it('Should allow burn (transfer to zero address)', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()

            await expect(nft.connect(alice).burn())
                .to.emit(nft, 'CreditIdentityBurned')

            expect(await nft.balanceOf(alice.address)).to.equal(0n)
            expect(await nft.hasIdentity(alice.address)).to.be.false
        })
    })

    // ────────────────────────────────────────────────────────────────────────
    //  Burn and Re-mint
    // ────────────────────────────────────────────────────────────────────────

    describe('Burn and Re-mint', function () {

        beforeEach(function () {
            if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
        })

        it('Should allow re-mint after burn', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)

            await nft.connect(alice).mint()
            expect(await nft.holderToken(alice.address)).to.equal(1n)

            await nft.connect(alice).burn()
            expect(await nft.hasIdentity(alice.address)).to.be.false

            // Re-mint — gets a new token ID
            await nft.connect(alice).mint()
            expect(await nft.holderToken(alice.address)).to.equal(2n)
            expect(await nft.hasIdentity(alice.address)).to.be.true
        })

        it('Should revert burn if caller is not the holder', async function () {
            const { nft, engine, alice, bob } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()

            await expect(nft.connect(bob).burn())
                .to.be.revertedWithCustomError(nft, 'NotHolder')
        })

        it('Should revert burn if caller has no token', async function () {
            const { nft, alice } = await loadFixture(deployFixture)
            await expect(nft.connect(alice).burn())
                .to.be.revertedWithCustomError(nft, 'NotHolder')
        })
    })

    // ────────────────────────────────────────────────────────────────────────
    //  Tier Refresh
    // ────────────────────────────────────────────────────────────────────────

    describe('Tier Refresh', function () {

        beforeEach(function () {
            if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
        })

        it('Should start as Unrated before score is publicly decrypted', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()

            const [, tier] = await nft.getTokenData(alice.address)
            expect(tier).to.equal(0n) // CreditTier.Unrated
        })

        it('Should update tier after public score decryption', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()

            // Request public decryption
            await engine.connect(alice).requestScoreDecryption()

            // In mock environment, decryption may resolve synchronously
            const [score, isDecrypted] = await engine.getDecryptedScore(alice.address)

            // Refresh tier metadata on the NFT
            await expect(nft.refreshTier(alice.address))
                .to.emit(nft, 'TierRefreshed')

            const [, tier, histLen] = await nft.getTokenData(alice.address)
            // histLen should be 1 (one computeCreditScore call)
            expect(histLen).to.equal(1n)

            // Tier is either Unrated (if async) or resolved tier
            if (isDecrypted && score >= 580) {
                expect(tier).to.be.gt(0n) // Any tier above Unrated
            }
        })

        it('Should revert refreshTier for non-existent token', async function () {
            const { nft, alice } = await loadFixture(deployFixture)
            await expect(nft.refreshTier(alice.address))
                .to.be.revertedWithCustomError(nft, 'TokenNotFound')
        })

        it('Should increment scoreHistoryLength after each computeCreditScore', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()

            // history length is 1 after first computation
            const [, , histLen1] = await nft.getTokenData(alice.address)
            expect(histLen1).to.equal(1n)

            // Compute score again
            await engine.connect(alice).computeCreditScore()

            // Refresh — should now show history length 2
            await nft.refreshTier(alice.address)
            const [, , histLen2] = await nft.getTokenData(alice.address)
            expect(histLen2).to.equal(2n)
        })
    })

    // ────────────────────────────────────────────────────────────────────────
    //  tokenURI — on-chain SVG
    // ────────────────────────────────────────────────────────────────────────

    describe('tokenURI', function () {

        beforeEach(function () {
            if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
        })

        it('Should return a data URI for a valid token', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()

            const tokenId = await nft.holderToken(alice.address)
            const uri = await nft.tokenURI(tokenId)

            expect(uri).to.match(/^data:application\/json;base64,/)
        })

        it('Should embed an SVG in the JSON metadata', async function () {
            const { nft, engine, alice } = await loadFixture(deployFixture)
            await setupUserWithScore(engine, alice)
            await nft.connect(alice).mint()

            const tokenId = await nft.holderToken(alice.address)
            const uri = await nft.tokenURI(tokenId)

            // Decode base64 JSON
            const jsonBase64 = uri.replace('data:application/json;base64,', '')
            const json = JSON.parse(Buffer.from(jsonBase64, 'base64').toString('utf8'))

            expect(json.name).to.include('Shadow Credit Identity')
            expect(json.image).to.match(/^data:image\/svg\+xml;base64,/)
            expect(json.attributes).to.be.an('array').with.length(4)
        })

        it('Should revert tokenURI for non-existent token', async function () {
            const { nft } = await loadFixture(deployFixture)
            await expect(nft.tokenURI(999n))
                .to.be.revertedWithCustomError(nft, 'TokenNotFound')
        })
    })

    // ────────────────────────────────────────────────────────────────────────
    //  Admin
    // ────────────────────────────────────────────────────────────────────────

    describe('Admin', function () {

        it('Should allow owner to update credit engine', async function () {
            const { nft, owner, engineAddr } = await loadFixture(deployFixture)
            const newAddr = '0x000000000000000000000000000000000000dEaD'

            await expect(nft.connect(owner).setCreditEngine(newAddr))
                .to.emit(nft, 'CreditEngineUpdated')
                .withArgs(newAddr)

            expect(await nft.creditEngine()).to.equal(newAddr)
        })

        it('Should revert if non-owner tries to update credit engine', async function () {
            const { nft, alice } = await loadFixture(deployFixture)
            await expect(
                nft.connect(alice).setCreditEngine(hre.ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(nft, 'OwnableUnauthorizedAccount')
        })
    })

    // ────────────────────────────────────────────────────────────────────────
    //  Full lifecycle integration
    // ────────────────────────────────────────────────────────────────────────

    describe('Full Lifecycle', function () {

        beforeEach(function () {
            if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
        })

        it('Should complete full credit identity lifecycle', async function () {
            const { nft, engine, alice, bob } = await loadFixture(deployFixture)

            // 1. Alice gets a credit score
            await setupUserWithScore(engine, alice)
            expect(await engine.hasCreditScore(alice.address)).to.be.true

            // 2. Alice mints her credit identity NFT
            await expect(nft.connect(alice).mint())
                .to.emit(nft, 'CreditIdentityMinted')
            expect(await nft.balanceOf(alice.address)).to.equal(1n)

            // 3. Transfer is blocked — NFT is soulbound
            const tokenId = await nft.holderToken(alice.address)
            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, tokenId)
            ).to.be.revertedWithCustomError(nft, 'Soulbound')

            // 4. Alice computes a second score (history length grows)
            await engine.connect(alice).computeCreditScore()
            await nft.refreshTier(alice.address)
            const [, , histLen] = await nft.getTokenData(alice.address)
            expect(histLen).to.equal(2n)

            // 5. tokenURI is valid
            const uri = await nft.tokenURI(tokenId)
            expect(uri).to.match(/^data:application\/json;base64,/)

            // 6. Alice burns her NFT and re-mints
            await nft.connect(alice).burn()
            expect(await nft.hasIdentity(alice.address)).to.be.false

            await nft.connect(alice).mint()
            expect(await nft.hasIdentity(alice.address)).to.be.true
            expect(await nft.totalMinted()).to.equal(2n) // token IDs 1 and 2
        })
    })
})
