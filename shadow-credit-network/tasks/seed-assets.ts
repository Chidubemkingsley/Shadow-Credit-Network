import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

task('seed-assets', 'Disable old assets, fund new pools so borrowing works immediately')
    .setAction(async (_args: any, hre: HardhatRuntimeEnvironment) => {
        const { ethers } = hre
        const [deployer] = await ethers.getSigners()
        console.log(`Deployer: ${deployer.address}`)

        const MULTI_POOL_ADDR = '0xEED53AF3E8037Ff80EACe9ABD8102a60A4AD2ce9'
        const multiPool = await ethers.getContractAt('MultiAssetLoanPool', MULTI_POOL_ADDR)

        // Old (pre-existing) asset addresses — disable them to avoid UI confusion
        const OLD_ASSETS = [
            '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',  // old USDC
            '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',  // old WETH
            '0x53F6519588372fB94307338aF226868f43c204F6',  // SCT
        ]

        // Our new TestERC20 tokens — fund these pools
        const NEW_TOKENS: { address: string; symbol: string; decimals: number; fundAmount: string }[] = [
            { address: '0x491ECb099a7E96d480256C2368620Cb5025CccCc', symbol: 'USDC', decimals: 6,  fundAmount: '50000' },
            { address: '0xDc44218E093f4E1959d7232550dBC56F6F76342E', symbol: 'WETH', decimals: 18, fundAmount: '100' },
            { address: '0xe53179158d4E5221703dEf34903E04FBd98DF7f7', symbol: 'DAI',  decimals: 18, fundAmount: '100000' },
        ]

        // 1. Disable old assets
        console.log('\nDisabling old/pre-existing assets...')
        for (const addr of OLD_ASSETS) {
            try {
                await multiPool.disableAsset(addr)
                console.log(`  ✓ Disabled ${addr}`)
            } catch (e: any) {
                console.log(`  ✗ Failed to disable ${addr}: ${e.message?.slice(0, 60)}`)
            }
        }

        // 2. Fund new asset pools
        console.log('\nFunding new asset pools with initial liquidity...')
        for (const t of NEW_TOKENS) {
            const erc20 = await ethers.getContractAt('TestERC20', t.address)
            const balance = await erc20.balanceOf(deployer.address)
            const parsed = ethers.parseUnits(t.fundAmount, t.decimals)
            if (balance < parsed) {
                // Mint more if needed
                const tx = await erc20.mint(deployer.address, parsed - balance)
                await tx.wait()
                console.log(`  Minted ${t.fundAmount} ${t.symbol} to deployer`)
            }
            // Approve pool to spend
            const approveTx = await erc20.approve(MULTI_POOL_ADDR, parsed)
            await approveTx.wait()
            console.log(`  Approved ${t.fundAmount} ${t.symbol} for pool`)
            // Fund the pool
            const fundTx = await multiPool.fundPool(t.address, parsed)
            await fundTx.wait()
            console.log(`  ✓ Funded ${t.fundAmount} ${t.symbol} into pool ($${t.fundAmount})`)
        }

        // 3. Show final state
        console.log('\nFinal pool state:')
        const count = await multiPool.getAssetCount()
        for (let i = 0; i < count; i++) {
            const addr = await multiPool.assetList(i)
            const cfg = await multiPool.assets(addr)
            const avail = cfg.totalLiquidity - cfg.totalLoanedOut
            console.log(`  [${i}] ${cfg.symbol} @ ${addr.slice(0, 10)}… enabled=${cfg.enabled} liquidity=${ethers.formatUnits(cfg.totalLiquidity, cfg.decimals)} available=${ethers.formatUnits(avail, cfg.decimals)} price=$${ethers.formatUnits(cfg.priceUsd18, 18)}`)
        }

        console.log('\nDone. Restart frontend — all 3 new tokens have liquidity. Borrow immediately.')
    })
