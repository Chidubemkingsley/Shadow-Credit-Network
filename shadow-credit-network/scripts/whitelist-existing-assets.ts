import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Using:', deployer.address)

  const NEW_POOL = '0x5566bB07eC68eC5a7eF6558E714B284dC4556c10'
  const OLD_POOL = '0xb0c432BA998787583C5D94C423c9F8A8705C7925'

  const pool = await ethers.getContractAt('MultiAssetLoanPool', NEW_POOL)
  const oldPool = await ethers.getContractAt('MultiAssetLoanPool', OLD_POOL)

  // Read existing assets from old pool
  const count = Number(await oldPool.getAssetCount())
  console.log(`\nOld pool has ${count} assets:`)

  for (let i = 0; i < count; i++) {
    const addr = await oldPool.assetList(i)
    const config = await oldPool.assets(addr)
    console.log(`  ${i}: ${config.symbol} at ${addr} (decimals: ${config.decimals}, price: ${ethers.formatEther(config.priceUsd18)} USD)`)
  }

  // Whitelist each on new pool
  for (let i = 0; i < count; i++) {
    const addr = await oldPool.assetList(i)
    const config = await oldPool.assets(addr)
    console.log(`\nWhitelisting ${config.symbol} (${addr}) on new pool...`)
    const tx = await pool.whitelistAsset(addr, config.decimals, config.symbol, config.priceUsd18)
    await tx.wait()
    console.log(`  ✓ ${config.symbol} whitelisted`)
  }

  // Verify
  const newCount = Number(await pool.getAssetCount())
  console.log(`\nNew pool now has ${newCount} assets:`)
  for (let i = 0; i < newCount; i++) {
    const addr = await pool.assetList(i)
    const config = await pool.assets(addr)
    console.log(`  ${i}: ${config.symbol} at ${addr} (enabled: ${config.enabled})`)
  }

  console.log('\nDone!')
}

main().catch(console.error)
