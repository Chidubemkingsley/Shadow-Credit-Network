import { ethers } from 'hardhat'

async function main() {
  const [signer] = await ethers.getSigners()
  const EP = '0x6EDCE65403992e310A62460808c4b910D972f10f'

  const options = ethers.solidityPacked(
    ['uint16', 'uint8', 'uint16', 'uint8', 'uint128'],
    [3, 1, 17, 1, 200000]
  )
  console.log('options hex:', options)

  const flatIfc = new ethers.Interface([
    'function quote(uint32 dstEid,bytes message,bytes options,bool payInLzToken) view returns (uint256 nativeFee, uint256 lzTokenFee)',
  ])
  const msgPayload = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint32', 'uint8', 'uint256', 'uint256', 'uint256', 'uint32'],
    [signer.address, 750, 4, 100, 100 + 180*86400, 5, 40231]
  )
  for (const payload of ['0x', msgPayload]) {
    const data = flatIfc.encodeFunctionData('quote', [40161, payload, options, false])
    try {
      const r = await ethers.provider.call({ to: EP, data })
      const d = flatIfc.decodeFunctionResult('quote', r)
      console.log(`quote(flat, payload len=${payload.length}) OK: nativeFee=${d[0].toString()}, lzTokenFee=${d[1].toString()}`)
    } catch (e: any) {
      console.log(`quote(flat, payload len=${payload.length}) FAIL:`, e.message?.slice(0,150))
    }
  }

  const structIfc = new ethers.Interface([
    'function quote((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) calldata _sendParam, address _sender) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)',
  ])
  const sendParam = {
    dstEid: 40161,
    receiver: ethers.zeroPadValue('0x84cd0229e4fC612090ff8cB735291807028b362f', 32),
    message: '0x',
    options: options,
    payInLzToken: false,
  }
  const data2 = structIfc.encodeFunctionData('quote', [sendParam, ethers.ZeroAddress])
  try {
    const r2 = await ethers.provider.call({ to: EP, data: data2 })
    const d2 = structIfc.decodeFunctionResult('quote', r2)
    console.log('quote(struct) OK: nativeFee=' + d2.fee.nativeFee.toString() + ', lzTokenFee=' + d2.fee.lzTokenFee.toString())
  } catch (e: any) {
    console.log('quote(struct) FAIL:', e.message?.slice(0,150))
  }
}
main().catch(console.error)
