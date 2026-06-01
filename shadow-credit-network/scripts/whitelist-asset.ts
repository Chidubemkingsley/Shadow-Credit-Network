import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Using:', deployer.address)

  const TestERC20 = await ethers.getContractFactory('TestERC20')
  const token = await TestERC20.deploy('Shadow USD', 'sUSD', ethers.parseEther('1000000'))
  await token.waitForDeployment()
  const tokenAddr = await token.getAddress()
  console.log('Token:', tokenAddr)

  const fs = require('fs')
  const deployments = JSON.parse(fs.readFileSync('./deployments/arb-sepolia.json', 'utf8'))
  const poolAddr: string = deployments.MultiAssetLoanPool
  console.log('Pool:', poolAddr)

  const pool = await ethers.getContractAt('MultiAssetLoanPool', poolAddr)
  const tx = await pool.whitelistAsset(tokenAddr, 18, 'sUSD', ethers.parseEther('1'))
  await tx.wait()
  console.log('✓ Whitelisted')

  const mintTx = await token.mint(deployer.address, ethers.parseEther('10000'))
  await mintTx.wait()
  console.log('✓ Minted 10000 sUSD to deployer')

  const config = await pool.assets(tokenAddr)
  console.log('Asset:', { enabled: config.enabled, symbol: config.symbol, priceUsd18: ethers.formatEther(config.priceUsd18) })

  // Save token address
  deployments.TestERC20 = tokenAddr
  fs.writeFileSync('./deployments/arb-sepolia.json', JSON.stringify(deployments, null, 2))

  // Also add to frontend .env.local
  const envPath = './frontend/.env.local'
  let env = fs.readFileSync(envPath, 'utf8')
  env += `\nVITE_SUSD_ADDRESS=${tokenAddr}\n`
  fs.writeFileSync(envPath, env)
  console.log('✓ Updated .env.local with sUSD address')
}

main().catch(console.error)
