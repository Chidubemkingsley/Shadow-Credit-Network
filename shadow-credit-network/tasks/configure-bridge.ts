import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

/**
 * configure-bridge
 *
 * Sets trusted remotes on the CrossChainCreditBridge so that quoteSend()
 * and sendScore() work without reverting from the LZ endpoint.
 *
 * For a single-chain demo (Arbitrum Sepolia only), we register the bridge
 * as its own trusted remote (loopback). This satisfies the LZ endpoint's
 * peer check and lets the full send/receive flow be demonstrated on one chain.
 *
 * For a real cross-chain setup, deploy a second bridge on the destination
 * chain and pass its address via --remote.
 *
 * Usage:
 *   # Loopback (self-peer) — works on any single chain:
 *   npx hardhat configure-bridge --network arb-sepolia
 *
 *   # Real remote on a different chain:
 *   npx hardhat configure-bridge --network arb-sepolia \
 *     --dsteid 40161 \
 *     --remote 0xYourEthSepoliaBridgeAddress
 */
task('configure-bridge', 'Configure trusted remotes on CrossChainCreditBridge')
    .addOptionalParam('bridge',  'Bridge contract address (defaults to VITE_CROSS_CHAIN_CREDIT_BRIDGE_ADDRESS)')
    .addOptionalParam('dsteid',  'Destination EID to register (default: same as localEid — loopback)')
    .addOptionalParam('remote',  'Remote bridge address as bytes32 or 0x address (default: this bridge — loopback)')
    .setAction(async (args: any, hre: HardhatRuntimeEnvironment) => {
        const { ethers } = hre

        const [deployer] = await ethers.getSigners()
        console.log(`\nDeployer: ${deployer.address}`)
        console.log(`Network:  ${hre.network.name}\n`)

        // ── Resolve bridge address ────────────────────────────────────
        const bridgeAddr: string = args.bridge
            || process.env.VITE_CROSS_CHAIN_CREDIT_BRIDGE_ADDRESS
            || (() => { throw new Error('Pass --bridge <addr> or set VITE_CROSS_CHAIN_CREDIT_BRIDGE_ADDRESS') })()

        const BRIDGE_ABI = [
            'function localEid() external view returns (uint32)',
            'function trustedRemotes(uint32) external view returns (bytes32)',
            'function setTrustedRemote(uint32 eid, bytes32 remoteAddress) external',
            'function addressToBytes32(address addr) external pure returns (bytes32)',
            'function owner() external view returns (address)',
            'function endpoint() external view returns (address)',
            'function creditEngine() external view returns (address)',
        ]

        const bridge = new ethers.Contract(bridgeAddr, BRIDGE_ABI, deployer)

        // ── Read current state ────────────────────────────────────────
        const [localEid, owner, endpoint, creditEngine] = await Promise.all([
            bridge.localEid(),
            bridge.owner(),
            bridge.endpoint(),
            bridge.creditEngine(),
        ])

        console.log(`Bridge:       ${bridgeAddr}`)
        console.log(`localEid:     ${localEid}`)
        console.log(`owner:        ${owner}`)
        console.log(`endpoint:     ${endpoint}`)
        console.log(`creditEngine: ${creditEngine}`)

        if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
            throw new Error(`Deployer ${deployer.address} is not the bridge owner (${owner})`)
        }

        // ── Resolve destination EID and remote address ────────────────
        const dstEid: number = args.dsteid ? Number(args.dsteid) : Number(localEid)

        let remoteBytes32: string
        if (args.remote) {
            if (args.remote.startsWith('0x') && args.remote.length === 66) {
                // Already bytes32
                remoteBytes32 = args.remote
            } else {
                // Convert address to bytes32
                remoteBytes32 = await bridge.addressToBytes32(args.remote)
            }
        } else {
            // Loopback: use this bridge's own address
            remoteBytes32 = await bridge.addressToBytes32(bridgeAddr)
        }

        const isLoopback = dstEid === Number(localEid)
        console.log(`\nSetting trusted remote:`)
        console.log(`  dstEid:  ${dstEid}${isLoopback ? ' (loopback — same chain)' : ''}`)
        console.log(`  remote:  ${remoteBytes32}`)

        // ── Check if already set ──────────────────────────────────────
        const existing = await bridge.trustedRemotes(dstEid)
        if (existing === remoteBytes32) {
            console.log(`\n✓ Already set — no transaction needed.`)
            return
        }
        if (existing !== ethers.ZeroHash && existing !== '0x' + '0'.repeat(63) + '1') {
            console.log(`  (replacing existing: ${existing})`)
        }

        // ── Send transaction ──────────────────────────────────────────
        console.log(`\nSending setTrustedRemote(${dstEid}, ${remoteBytes32})...`)
        const tx = await bridge.setTrustedRemote(dstEid, remoteBytes32)
        console.log(`  tx: ${tx.hash}`)
        await tx.wait()
        console.log(`  ✓ Confirmed`)

        // ── Verify ────────────────────────────────────────────────────
        const stored = await bridge.trustedRemotes(dstEid)
        console.log(`\nVerification:`)
        console.log(`  trustedRemotes(${dstEid}) = ${stored}`)
        console.log(stored === remoteBytes32 ? '  ✓ Match' : '  ✗ Mismatch — check transaction')

        console.log(`\nDone. quoteSend(${dstEid}) should now return a fee without reverting.`)
        if (isLoopback) {
            console.log(`Note: loopback mode — sendScore(${dstEid}) will send to this same bridge.`)
            console.log(`      lzReceive() will be called by the LZ executor and store the score.`)
        }
    })
