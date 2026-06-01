import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

task('whitelist-assets', 'Deploy mock tokens and whitelist on existing MultiAssetLoanPool')
    .setAction(async (_args: any, hre: HardhatRuntimeEnvironment) => {
        const { ethers } = hre
        const [deployer] = await ethers.getSigners()
        console.log(`Deployer: ${deployer.address}`)

        const MULTI_POOL_ADDR = '0x384B2460d7AC08Cef74B02E4D80108aDCa4B4A12'

        const multiPool = await ethers.getContractAt('MultiAssetLoanPool', MULTI_POOL_ADDR)
        const owner = await multiPool.owner()
        if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
            console.error(`Not owner — pool owner is ${owner}`)
            return
        }

        // 1. Deploy tokens
        const TestERC20 = await ethers.getContractFactory('TestERC20')

        const usdc = await TestERC20.deploy('USD Coin', 'USDC', ethers.parseUnits('1000000', 6))
        await usdc.waitForDeployment()
        const usdcAddr = await usdc.getAddress()
        console.log(`MockUSDC: ${usdcAddr}`)

        const weth = await TestERC20.deploy('Wrapped Ether', 'WETH', ethers.parseUnits('1000000', 18))
        await weth.waitForDeployment()
        const wethAddr = await weth.getAddress()
        console.log(`MockWETH: ${wethAddr}`)

        const dai = await TestERC20.deploy('Dai Stablecoin', 'DAI', ethers.parseUnits('1000000', 18))
        await dai.waitForDeployment()
        const daiAddr = await dai.getAddress()
        console.log(`MockDAI:  ${daiAddr}`)

        // 2. Whitelist
        await multiPool.whitelistAsset(usdcAddr, 6, 'USDC', ethers.parseUnits('1', 18))
        console.log('USDC whitelisted — $1.00')

        await multiPool.whitelistAsset(wethAddr, 18, 'WETH', ethers.parseUnits('3500', 18))
        console.log('WETH whitelisted — $3,500.00')

        await multiPool.whitelistAsset(daiAddr, 18, 'DAI', ethers.parseUnits('1', 18))
        console.log('DAI whitelisted — $1.00')

        // 3. Verify
        const count = await multiPool.getAssetCount()
        console.log(`\nAssets whitelisted: ${count}`)
        for (let i = 0; i < count; i++) {
            const addr = await multiPool.assetList(i)
            const cfg = await multiPool.assets(addr)
            console.log(`  [${i}] ${cfg.symbol} @ ${addr} — $${ethers.formatUnits(cfg.priceUsd18, 18)} enabled=${cfg.enabled}`)
        }

        console.log('\nDone. Restart your frontend and try again.')
    })
