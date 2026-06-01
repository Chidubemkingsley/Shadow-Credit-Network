import { ethers, network } from 'hardhat'

async function main() {
  console.log(`\nContinuing deployment on ${network.name} (${network.config.chainId})...\n`)
  const [deployer] = await ethers.getSigners()
  console.log(`Deployer: ${deployer.address}`)
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`)

  const repAddr = '0xd5290584ECf6c38674709cAa0ECF4C7Dc27463c2'
  const engineAddr = '0x1d93EC7f5339F714a68AdE332aDDa5494c07a294'
  const poolAddr = '0x2A19929e0f0e0e9eeE2E77Af4fe697De05FAf7e3'
  const delegationAddr = '0xc3Ff91EF99fcB8AE19CAc7698BB1eFAAd704C243'

  // 1. Wire delegation
  console.log('1/5 Wiring CreditDelegationV2...')
  const delegation = await ethers.getContractAt('CreditDelegationV2', delegationAddr)
  let tx = await delegation.setCreditEngine(engineAddr); await tx.wait()
  console.log('  ✓ CreditEngine set')
  tx = await delegation.setReputationRegistry(repAddr); await tx.wait()
  console.log('  ✓ ReputationRegistry set')
  const rep = await ethers.getContractAt('ReputationRegistry', repAddr)
  tx = await rep.setIntegrationContract(delegationAddr); await tx.wait()
  console.log('  ✓ Delegation authorized in ReputationRegistry')

  // 2. CreditDataWithZK
  console.log('\n2/5 Deploying CreditDataWithZK...')
  const ZKBridge = await ethers.getContractFactory('CreditDataWithZK')
  const zkBridge = await ZKBridge.deploy(deployer.address)
  await zkBridge.waitForDeployment()
  const zkAddr = await zkBridge.getAddress()
  tx = await zkBridge.setCreditEngine(engineAddr); await tx.wait()
  console.log(`  ✓ CreditDataWithZK: ${zkAddr}`)

  // 3. ScoreGatedGovernance
  console.log('\n3/5 Deploying ScoreGatedGovernance...')
  const Gov = await ethers.getContractFactory('ScoreGatedGovernance')
  const gov = await Gov.deploy(deployer.address, engineAddr, poolAddr)
  await gov.waitForDeployment()
  const govAddr = await gov.getAddress()
  console.log(`  ✓ ScoreGatedGovernance: ${govAddr}`)

  // 4. SoulboundCreditNFT
  console.log('\n4/5 Deploying SoulboundCreditNFT...')
  const NFT = await ethers.getContractFactory('SoulboundCreditNFT')
  const nft = await NFT.deploy(deployer.address, engineAddr)
  await nft.waitForDeployment()
  const nftAddr = await nft.getAddress()
  console.log(`  ✓ SoulboundCreditNFT: ${nftAddr}`)

  // 5. MultiAssetLoanPool
  console.log('\n5/5 Deploying MultiAssetLoanPool...')
  const MultiPool = await ethers.getContractFactory('MultiAssetLoanPool')
  const multiPool = await MultiPool.deploy(deployer.address)
  await multiPool.waitForDeployment()
  const multiPoolAddr = await multiPool.getAddress()
  tx = await multiPool.setCreditEngine(engineAddr); await tx.wait()
  tx = await multiPool.setReputationRegistry(repAddr); await tx.wait()
  console.log(`  ✓ MultiAssetLoanPool: ${multiPoolAddr}`)

  // 6. CrossChainCreditBridge
  console.log('\n6/6 Deploying CrossChainCreditBridge...')
  const LZ_ENDPOINT = '0x6EDCE65403992e310A62460808c4b910D972f10f'
  const LZ_EID = 40231
  const Bridge = await ethers.getContractFactory('CrossChainCreditBridge')
  const bridge = await Bridge.deploy(deployer.address, LZ_ENDPOINT, engineAddr, LZ_EID)
  await bridge.waitForDeployment()
  const bridgeAddr = await bridge.getAddress()
  console.log(`  ✓ CrossChainCreditBridge: ${bridgeAddr}`)

  // Summary
  console.log('\n========================================')
  console.log('Deployment Complete!')
  console.log('========================================\n')
  console.log('Contract Addresses:')
  console.log('-'.repeat(60))
  console.log(`  ReputationRegistry          ${repAddr}`)
  console.log(`  EncryptedCreditEngineV3     ${engineAddr}`)
  console.log(`  PrivateLoanPoolV3           ${poolAddr}`)
  console.log(`  CreditDelegationV2          ${delegationAddr}`)
  console.log(`  CreditDataWithZK            ${zkAddr}`)
  console.log(`  ScoreGatedGovernance        ${govAddr}`)
  console.log(`  SoulboundCreditNFT          ${nftAddr}`)
  console.log(`  MultiAssetLoanPool          ${multiPoolAddr}`)
  console.log(`  CrossChainCreditBridge      ${bridgeAddr}`)
  console.log('-'.repeat(60))
}

main().catch(console.error)
