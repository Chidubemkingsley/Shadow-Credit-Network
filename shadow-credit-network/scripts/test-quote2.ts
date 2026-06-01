import { ethers } from 'hardhat'

async function main() {
  const [signer] = await ethers.getSigners()
  const BRIDGE_ABI = [
    'function quoteSend(uint32 dstEid) view returns (uint256 nativeFee)',
    'function localEid() view returns (uint32)',
    'function trustedRemotes(uint32) view returns (bytes32)',
  ]
  const bridgeAddr = '0xBF912976894b525663c341F938CC17Efc19CE9B3'
  const bridge = new ethers.Contract(bridgeAddr, BRIDGE_ABI, signer)

  const eid = await bridge.localEid()
  console.log('localEid:', eid.toString())

  for (const dst of [40161, 40232, 40216]) {
    const tr = await bridge.trustedRemotes(dst)
    console.log('trustedRemote(' + dst + '):', tr)
  }

  for (const dst of [40161, 40232, 40216]) {
    try {
      const fee = await bridge.quoteSend(dst)
      console.log(`quoteSend(${dst}) success! nativeFee: ${fee.toString()}`)
    } catch (err: any) {
      console.log(`quoteSend(${dst}) failed:`, err.message?.slice(0, 200))
      if (err.data) console.log('  data:', err.data)
      if (err.code === 'CALL_EXCEPTION') {
        console.log('  reason:', err.reason)
        console.log('  method:', err.method)
        console.log('  signature:', err.signature)
      }
    }
  }
}
main().catch(console.error)
