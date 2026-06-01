import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment, getDeployment } from './utils'

const LZ_ENDPOINT = '0x6EDCE65403992e310A62460808c4b910D972f10f'

const CHAIN_CONFIGS: Record<string, { eid: number; engine: string }> = {
  'arb-sepolia':       { eid: 40231, engine: '0xaaF38A665e74EdE56a7549B193e007B3976eF184' },
  'eth-sepolia':       { eid: 40161, engine: '0xe6B58316Fae3e41B91a0CDa132e67Fe4737513b1' },
  'base-sepolia':      { eid: 40232, engine: '0x5A03628A15674c425606e0D4710D66EBa8da09E6' },
  'optimism-sepolia':  { eid: 40245, engine: '0x0000000000000000000000000000000000000000' },
  'polygon-amoy':      { eid: 40168, engine: '0x0000000000000000000000000000000000000000' },
  'avalanche-fuji':    { eid: 40216, engine: '0x0000000000000000000000000000000000000000' },
  'bnb-testnet':       { eid: 40273, engine: '0x0000000000000000000000000000000000000000' },
  'helium':            { eid: 40280, engine: '0x0000000000000000000000000000000000000000' },
}

task('deploy-bridge', 'Deploy CrossChainCreditBridge on the current network')
  .addOptionalParam('engine', 'Credit engine address (overrides default)')
  .addFlag('redeploy', 'Force redeploy even if already deployed')
  .setAction(async (args: any, hre: HardhatRuntimeEnvironment) => {
    const { ethers, network } = hre
    const netName = network.name
    const cfg = CHAIN_CONFIGS[netName]

    if (!cfg) {
      console.error(`No chain config for network "${netName}"`)
      console.error(`Known: ${Object.keys(CHAIN_CONFIGS).join(', ')}`)
      return
    }

    const existingBridge = getDeployment(netName, 'CrossChainCreditBridge')
    if (existingBridge && !args.redeploy) {
      console.log(`\nBridge already deployed on ${netName}: ${existingBridge}`)
      console.log(`(Use --redeploy to force a new deployment)`)
      const [deployer] = await ethers.getSigners()
      console.log(`Deployer: ${deployer.address}`)
      const bridge = new ethers.Contract(existingBridge, [
        'function owner() view returns (address)',
        'function localEid() view returns (uint32)',
        'function endpoint() view returns (address)',
        'function creditEngine() view returns (address)',
      ], deployer)
      const [owner, localEid, endpoint, engine] = await Promise.all([
        bridge.owner(), bridge.localEid(), bridge.endpoint(), bridge.creditEngine(),
      ])
      console.log(`  owner:       ${owner}`)
      console.log(`  localEid:    ${localEid}`)
      console.log(`  endpoint:    ${endpoint}`)
      console.log(`  engine:      ${engine}`)
      return
    }

    const [deployer] = await ethers.getSigners()
    const bal = await ethers.provider.getBalance(deployer.address)
    console.log(`\nNetwork:  ${netName} (chainId: ${network.config.chainId})`)
    console.log(`Deployer: ${deployer.address}`)
    console.log(`Balance:  ${ethers.formatEther(bal)} ETH`)
    console.log(`LZ EID:   ${cfg.eid}`)
    console.log(`Engine:   ${args.engine || cfg.engine}`)

    if (bal < ethers.parseEther('0.002')) {
      console.log(`\n⚠  Insufficient balance — need at least 0.002 ETH`)
      return
    }

    console.log(`\nDeploying CrossChainCreditBridge...`)
    const Bridge = await ethers.getContractFactory('CrossChainCreditBridge')
    const engineAddr = args.engine || cfg.engine
    const bridge = await Bridge.deploy(deployer.address, LZ_ENDPOINT, engineAddr, cfg.eid)
    await bridge.waitForDeployment()
    const addr = await bridge.getAddress()

    saveDeployment(netName, 'CrossChainCreditBridge', addr)
    console.log(`\n✓ Bridge deployed: ${addr}`)
  })
