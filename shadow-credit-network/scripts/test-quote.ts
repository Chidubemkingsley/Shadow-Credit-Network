import { ethers } from 'hardhat'

async function main() {
  const [signer] = await ethers.getSigners()
  const BRIDGE_ABI = [
    'function quoteSend(tuple(uint32 dstEid, bytes32 to, bytes32 guid, bytes message, bytes extraOptions, bool composeMsg, bytes composedMsg) calldata _sendParam) external view returns (tuple(uint256 nativeFee, uint256 lzTokenFee) fee)',
    'function localEid() view returns (uint32)',
    'function trustedRemotes(uint32) view returns (bytes32)',
  ]
  const bridge = new ethers.Contract('0x1453d315dcB2F3B7d0a54EB257011F8322e2a7C9', BRIDGE_ABI, signer)
  const eid = await bridge.localEid()
  console.log('localEid:', eid.toString())
  for (const dst of [40161, 40232, 40216]) {
    const tr = await bridge.trustedRemotes(dst)
    console.log('trustedRemote(' + dst + '):', tr)
  }
  const sendParam = {
    dstEid: 40161,
    to: '0x' + '0'.repeat(63) + '1',
    guid: ethers.ZeroHash,
    message: '0x',
    extraOptions: '0x',
    composeMsg: false,
    composedMsg: '0x',
  }
  try {
    const quote = await bridge.quoteSend(sendParam)
    console.log('quoteSend success! nativeFee:', quote.fee.nativeFee.toString(), 'lzTokenFee:', quote.fee.lzTokenFee.toString())
  } catch (err: any) {
    console.log('quoteSend failed:', err.message?.slice(0, 300))
    if (err.data) console.log('err.data:', err.data)
  }
}
main().catch(console.error)
