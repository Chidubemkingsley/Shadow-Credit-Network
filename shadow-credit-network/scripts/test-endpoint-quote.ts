import { ethers } from 'hardhat'

async function main() {
  const [signer] = await ethers.getSigners()
  const EP = '0x6EDCE65403992e310A62460808c4b910D972f10f'

  const iface = new ethers.Interface([
    'function quote(uint32 dstEid,bytes message,bytes options,bool payInLzToken) view returns (uint256 nativeFee, uint256 lzTokenFee)',
  ])

  // Try 1: empty message, empty options
  const data1 = iface.encodeFunctionData('quote', [40161, '0x', '0x', false])
  try {
    const r1 = await ethers.provider.call({ to: EP, data: data1 })
    const d1 = iface.decodeFunctionResult('quote', r1)
    console.log('quote(empty) OK:', d1[0].toString(), d1[1].toString())
  } catch (e: any) { console.log('quote(empty) FAIL:', e.message?.slice(0,150)) }

  // Try 2: with default options (type 1 encoding)
  const defaultOptions = '0x0001002100000000000000000000000000000000000000000000000000000000030d400000000000000000000000000000000000000000000000000000000000000000'
  const data2 = iface.encodeFunctionData('quote', [40161, '0x', defaultOptions, false])
  try {
    const r2 = await ethers.provider.call({ to: EP, data: data2 })
    const d2 = iface.decodeFunctionResult('quote', r2)
    console.log('quote(options) OK:', d2[0].toString(), d2[1].toString())
  } catch (e: any) { console.log('quote(options) FAIL:', e.message?.slice(0,150)) }
}
main().catch(console.error)
