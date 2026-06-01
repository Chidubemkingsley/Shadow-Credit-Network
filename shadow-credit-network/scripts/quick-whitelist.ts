import { ethers } from 'ethers'
import * as fs from 'fs'

async function main() {
  const pkey = fs.readFileSync('/tmp/pkey', 'utf8').trim()
  const provider = new ethers.JsonRpcProvider('https://arbitrum-sepolia.publicnode.com', undefined, { polling: true, timeout: 30000 })
  const deployer = new ethers.Wallet(pkey, provider)

  console.log('Using:', deployer.address)

  const deployments = JSON.parse(fs.readFileSync('./deployments/arb-sepolia.json', 'utf8'))
  const NEW_POOL = deployments.MultiAssetLoanPool
  const OLD_POOL = '0xb0c432BA998787583C5D94C423c9F8A8705C7925'

  console.log('New pool:', NEW_POOL)
  console.log('Old pool:', OLD_POOL)

  const abi = [
    'function whitelistAsset(address token, uint8 decimals, string symbol, uint256 priceUsd18) external',
    'function getAssetCount() view returns (uint256)',
    'function assetList(uint256) view returns (address)',
    'function assets(address) view returns (tuple(bool enabled, uint8 decimals, string symbol, uint256 priceUsd18, uint256 totalLiquidity, uint256 totalLoanedOut, uint256 totalInterest))',
  ]

  const pool = new ethers.Contract(NEW_POOL, abi, deployer)
  const oldPool = new ethers.Contract(OLD_POOL, abi, deployer)

  const count = Number(await oldPool.getAssetCount())
  console.log(`Old pool has ${count} assets`)

  for (let i = 0; i < count; i++) {
    const addr = await oldPool.assetList(i)
    const config = await oldPool.assets(addr)
    console.log(`  ${config.symbol}: ${addr}`)

    const tx = await pool.whitelistAsset(addr, config.decimals, config.symbol, config.priceUsd18)
    await tx.wait()
    console.log(`  ✓ ${config.symbol} whitelisted`)
  }

  const newCount = Number(await pool.getAssetCount())
  console.log(`\nNew pool has ${newCount} assets`)
  for (let i = 0; i < newCount; i++) {
    const addr = await pool.assetList(i)
    const config = await pool.assets(addr)
    console.log(`  ${config.symbol} at ${addr} (enabled: ${config.enabled})`)
  }

  console.log('\nDone!')
}

main().catch(console.error)
