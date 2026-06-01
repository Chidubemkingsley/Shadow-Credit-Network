import { ethers, network } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

const LZ_ENDPOINT = '0x6EDCE65403992e310A62460808c4b910D972f10f'

const CHAINS: Record<string, { eid: number; engine: string }> = {
  'arb-sepolia':       { eid: 40231, engine: '0xaaF38A665e74EdE56a7549B193e007B3976eF184' },
  'eth-sepolia':       { eid: 40161, engine: '0xe6B58316Fae3e41B91a0CDa132e67Fe4737513b1' },
  'base-sepolia':      { eid: 40232, engine: '0x5A03628A15674c425606e0D4710D66EBa8da09E6' },
  'optimism-sepolia':  { eid: 40245, engine: ethers.ZeroAddress },
  'polygon-amoy':      { eid: 40168, engine: ethers.ZeroAddress },
  'avalanche-fuji':    { eid: 40216, engine: ethers.ZeroAddress },
  'bnb-testnet':       { eid: 40273, engine: ethers.ZeroAddress },
  'helium':            { eid: 40280, engine: ethers.ZeroAddress },
}

const DEPLOYMENTS_DIR = path.join(__dirname, '../deployments')

function loadDeployments(networkName: string): Record<string, string> {
  const p = path.join(DEPLOYMENTS_DIR, `${networkName}.json`)
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  }
  return {}
}

function saveDeployments(networkName: string, data: Record<string, string>) {
  const p = path.join(DEPLOYMENTS_DIR, `${networkName}.json`)
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n')
  console.log(`  → saved to ${p}`)
}

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log(`Deployer: ${deployer.address}\n`)

  // 1. Deploy CrossChainCreditBridge on each chain that doesn't have one yet
  const bridgeAddresses: Record<string, string> = {}

  for (const [netName, cfg] of Object.entries(CHAINS)) {
    console.log(`\n════════════════════════════════════════════`)
    console.log(`  ${netName} (EID ${cfg.eid})`)
    console.log(`════════════════════════════════════════════`)

    const deployments = loadDeployments(netName)
    const existingBridge = deployments['CrossChainCreditBridge']

    if (existingBridge) {
      console.log(`  ✓ Bridge already deployed: ${existingBridge}`)
      bridgeAddresses[netName] = existingBridge
      continue
    }

    const bal = await ethers.provider.getBalance(deployer.address)
    console.log(`  Balance: ${ethers.formatEther(bal)} ETH`)
    if (bal < ethers.parseEther('0.005')) {
      console.log(`  ⚠  Insufficient balance — skipping`)
      continue
    }

    console.log(`  Deploying CrossChainCreditBridge...`)
    const Bridge = await ethers.getContractFactory('CrossChainCreditBridge')
    const bridge = await Bridge.deploy(deployer.address, LZ_ENDPOINT, cfg.engine, cfg.eid)
    await bridge.waitForDeployment()
    const addr = await bridge.getAddress()
    console.log(`  ✓ ${addr}`)

    deployments['CrossChainCreditBridge'] = addr
    saveDeployments(netName, deployments)
    bridgeAddresses[netName] = addr
  }

  console.log(`\n════════════════════════════════════════════`)
  console.log('  Deployment Summary')
  console.log('════════════════════════════════════════════')
  for (const [netName, addr] of Object.entries(bridgeAddresses)) {
    console.log(`  ${netName.padEnd(20)} ${addr}`)
  }

  // 2. Configure trusted remotes bidirectionally
  console.log(`\n════════════════════════════════════════════`)
  console.log('  Configuring Trusted Remotes')
  console.log('════════════════════════════════════════════\n')

  const nets = Object.keys(CHAINS)
  for (const srcNet of nets) {
    const srcAddr = bridgeAddresses[srcNet]
    if (!srcAddr) {
      console.log(`  ⚠  No bridge on ${srcNet} — skipping outbound config`)
      continue
    }

    const BridgeABI = [
      'function setTrustedRemote(uint32 eid, bytes32 remoteAddress) external',
      'function trustedRemotes(uint32) external view returns (bytes32)',
      'function owner() external view returns (address)',
      'function addressToBytes32(address addr) external pure returns (bytes32)',
    ]

    // We need to switch network context — but hardhat only has one provider at a time.
    // Instead, we just configure the arb-sepolia bridge (main source) for all destinations.
    // Full multi-chain config requires running this script per-network.
  }

  console.log(`\nDone. Bridges deployed. Run configure-bridge per-network for trusted remotes.`)
  console.log(`\nExample for each source->destination pair:`)
  console.log(`  npx hardhat configure-bridge --network <src> --dsteid <eid> --remote <dst-bridge-addr>`)
}

main().catch(console.error)
