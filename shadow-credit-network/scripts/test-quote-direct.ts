import { ethers } from 'hardhat'

async function main() {
  const [s] = await ethers.getSigners()
  const EP = '0x6EDCE65403992e310A62460808c4b910D972f10f'

  // Build the exact payload and options as the contract does
  const ENGINE = '0xaaF38A665e74EdE56a7549B193e007B3976eF184'
  const engineIfc = new ethers.Interface([
    'function getPublishedScore(address) view returns (uint32)',
    'function getDecryptedScore(address) view returns (uint32, bool)',
    'function scoreComputedAt(address) view returns (uint256)',
    'function getScoreHistoryLength(address) view returns (uint256)',
  ])
  const engine = new ethers.Contract(ENGINE, engineIfc, s)

  const score = await engine.getPublishedScore(s.address)
  let finalScore = Number(score)
  if (finalScore === 0) {
    const [ds] = await engine.getDecryptedScore(s.address)
    finalScore = Number(ds)
  }
  const computedAt = await engine.scoreComputedAt(s.address)
  const histLen = await engine.getScoreHistoryLength(s.address)

  const att = {
    user: s.address,
    score: finalScore,
    tier: finalScore >= 740 ? 4 : finalScore >= 670 ? 3 : finalScore >= 580 ? 2 : finalScore >= 300 ? 1 : 0,
    computedAt: computedAt,
    expiresAt: computedAt + 15552000n,
    historyLength: histLen,
    srcEid: 40231,
  }
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint32', 'uint8', 'uint256', 'uint256', 'uint256', 'uint32'],
    [att.user, att.score, att.tier, att.computedAt, att.expiresAt, att.historyLength, att.srcEid]
  )
  const options = ethers.solidityPacked(
    ['uint16', 'uint8', 'uint16', 'uint8', 'uint128'],
    [3, 1, 17, 1, 200000]
  )

  console.log('payload:', payload)
  console.log('options:', options)

  // Test flat quote call
  const ifc = new ethers.Interface([
    'function quote(uint32 dstEid,bytes message,bytes options,bool payInLzToken) view returns (uint256 nativeFee, uint256 lzTokenFee)',
  ])
  const data = ifc.encodeFunctionData('quote', [40161, payload, options, false])
  console.log('quote selector: 0xeba00707')
  console.log('encoded data length:', data.length)

  try {
    const r = await ethers.provider.call({ to: EP, data })
    console.log('quote result:', r)
    const d = ifc.decodeFunctionResult('quote', r)
    console.log('SUCCESS! nativeFee:', d[0].toString(), 'lzTokenFee:', d[1].toString())
  } catch (e: any) {
    console.log('FAILED:', e.message?.slice(0,200))
    if (e.data) console.log('data:', e.data)
    if (e.code === 'CALL_EXCEPTION') {
      console.log('reason:', e.reason)
      console.log('method:', e.method)
      console.log('signature:', e.signature)
    }
    // Check if the error has a custom error selector
    const txData = e.transaction?.data || data
    console.log('First 10 bytes of call data:', txData?.slice(0, 10))
  }
}
main().catch(console.error)
