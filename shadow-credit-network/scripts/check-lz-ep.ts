import { ethers } from 'hardhat'

async function main() {
  const [u] = await ethers.getSigners()
  const EP = '0x6EDCE65403992e310A62460808c4b910D972f10f'

  const sel = ethers.id('quote((uint32,bytes32,bytes,bytes,bool),address)')
  console.log('LZ V2 quote selector:', sel)

  const iface = new ethers.Interface([
    'function quote((uint32 dstEid,bytes32 receiver,bytes message,bytes options,bool payInLzToken),address payInLzToken) view returns (uint256 nativeFee, uint256 lzTokenFee)',
  ])

  const quoteData = iface.encodeFunctionData('quote', [
    { dstEid: 40161, receiver: ethers.ZeroHash, message: '0x', options: '0x', payInLzToken: false },
    ethers.ZeroAddress,
  ])
  console.log('quote data:', quoteData)

  try {
    const result = await ethers.provider.call({ from: u.address, to: EP, data: quoteData })
    console.log('quote OK:', result)
  } catch (e: any) {
    console.log('quote error:', e.message?.slice(0, 200))
  }

  // Try simplified bridge interface
  const iface2 = new ethers.Interface([
    'function quote(uint32 dstEid,bytes message,bytes options,bool payInLzToken) view returns (uint256 nativeFee, uint256 lzTokenFee)',
  ])
  const quoteData2 = iface2.encodeFunctionData('quote', [40161, '0x', '0x', false])
  console.log('\nbridge quote data:', quoteData2)

  try {
    const result = await ethers.provider.call({ from: u.address, to: EP, data: quoteData2 })
    console.log('bridge quote OK:', result)
  } catch (e: any) {
    console.log('bridge quote error:', e.message?.slice(0, 200))
  }
}

main().catch(console.error)
