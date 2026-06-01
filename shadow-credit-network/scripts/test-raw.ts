// Test quoteSend via raw RPC call to match what the frontend does
import { ethers } from 'hardhat'

async function main() {
  const BRIDGE = '0xBF912976894b525663c341F938CC17Efc19CE9B3'
  const [s] = await ethers.getSigners()

  // Encode quoteSend(40161) the way the frontend does it
  const ifc = new ethers.Interface([
    'function quoteSend(uint32 dstEid) view returns (uint256 nativeFee)',
  ])
  const data = ifc.encodeFunctionData('quoteSend', [40161])
  console.log('call data:', data)

  // Make raw eth_call
  try {
    const result = await ethers.provider.call({
      to: BRIDGE,
      data: data,
    })
    console.log('raw call result:', result)
    const fee = ifc.decodeFunctionResult('quoteSend', result)
    console.log('SUCCESS nativeFee:', fee[0].toString())
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0, 200))
    if (e.data) console.log('data:', e.data)
    if (e.code === 'CALL_EXCEPTION') {
      console.log('reason:', e.reason)
      console.log('signature:', e.signature)
      // Check revert data
      const revertData = e.data?.data || e.data
      console.log('revert data hex:', revertData)
    }
  }
}
main().catch(console.error)
