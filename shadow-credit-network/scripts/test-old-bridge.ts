import { ethers } from 'hardhat'

async function main() {
  const [signer] = await ethers.getSigners()
  const OLD = '0xF169fCc94874A08d6708fdCE42d16512F012F5d7'

  // Try the flat interface first
  const flatABI = [
    'function quoteSend(uint32 dstEid) view returns (uint256 nativeFee)',
    'function localEid() view returns (uint32)',
    'function trustedRemotes(uint32) view returns (bytes32)',
    'function endpoint() view returns (address)',
  ]
  try {
    const bridge = new ethers.Contract(OLD, flatABI, signer)
    const eid = await bridge.localEid()
    console.log('Old bridge localEid:', eid.toString())
    const ep = await bridge.endpoint()
    console.log('Old bridge endpoint:', ep)
    const tr = await bridge.trustedRemotes(40161)
    console.log('Old bridge trustedRemote(40161):', tr)
    const fee = await bridge.quoteSend(40161)
    console.log('Old bridge quoteSend(40161) OK:', fee.toString())
  } catch (e: any) {
    console.log('Old bridge flat failed:', e.message?.slice(0,200))
  }

  // Try with the struct-based SendParam quoteSend
  const structABI = [
    'function quoteSend(tuple(uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) calldata _sendParam) view returns (tuple(uint256 nativeFee, uint256 lzTokenFee) fee)',
  ]
  const sendParam = {
    dstEid: 40161,
    receiver: '0x' + '0'.repeat(63) + '1',
    message: '0x',
    options: '0x',
    payInLzToken: false,
  }
  try {
    const bridge2 = new ethers.Contract(OLD, structABI, signer)
    const fee2 = await bridge2.quoteSend(sendParam)
    console.log('Old bridge struct-quoteSend OK:', fee2.fee.nativeFee.toString())
  } catch (e: any) {
    console.log('Old bridge struct failed:', e.message?.slice(0,200))
  }
}
main().catch(console.error)
