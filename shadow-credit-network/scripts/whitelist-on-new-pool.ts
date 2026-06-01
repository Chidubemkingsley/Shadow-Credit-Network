import { ethers } from 'hardhat'
import * as fs from 'fs'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Using:', deployer.address)

  const deployments = JSON.parse(fs.readFileSync('./deployments/arb-sepolia.json', 'utf8'))
  const NEW_POOL = deployments.MultiAssetLoanPool
  const OLD_POOL = '0xb0c432BA998787583C5D94C423c9F8A8705C7925'

  console.log('New pool:', NEW_POOL)
  console.log('Old pool:', OLD_POOL)

  const pool = await ethers.getContractAt('MultiAssetLoanPool', NEW_POOL)
  const oldPool = await ethers.getContractAt('MultiAssetLoanPool', OLD_POOL)

  const count = Number(await oldPool.getAssetCount())
  console.log(`Old pool has ${count} assets`)
  for (let i = 0; i < count; i++) {
    const addr = await oldPool.assetList(i)
    const config = await oldPool.assets(addr)
    console.log(`  ${config.symbol}: ${addr}`)
  }

  for (let i = 0; i < count; i++) {
    const addr = await oldPool.assetList(i)
    const config = await oldPool.assets(addr)
    console.log(`\n  Whitelisting ${config.symbol}...`)
    const tx = await pool.whitelistAsset(addr, config.decimals, config.symbol, config.priceUsd18)
    await tx.wait()
    console.log(`  ✓ ${config.symbol}`)
  }

  const newCount = Number(await pool.getAssetCount())
  console.log(`\nNew pool assets: ${newCount}`)
  for (let i = 0; i < newCount; i++) {
    const addr = await pool.assetList(i)
    const config = await pool.assets(addr)
    console.log(`  ${config.symbol} at ${addr} (enabled: ${config.enabled})`)
  }

  console.log('\nDone!')
}

main().catch(console.error)
