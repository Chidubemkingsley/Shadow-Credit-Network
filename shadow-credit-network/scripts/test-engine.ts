import { ethers } from 'hardhat'

async function main() {
  const [signer] = await ethers.getSigners()
  const ENGINE = '0xaaF38A665e74EdE56a7549B193e007B3976eF184'
  
  const ifc = new ethers.Interface([
    'function isRegistered(address) view returns (bool)',
    'function getPublishedScore(address) view returns (uint32)',
    'function getDecryptedScore(address) view returns (uint32, bool)',
    'function scoreComputedAt(address) view returns (uint256)',
    'function getScoreHistoryLength(address) view returns (uint256)',
    'function hasCreditScore(address) view returns (bool)',
    'function isScoreStale(address) view returns (bool)',
  ])
  const engine = new ethers.Contract(ENGINE, ifc, signer)
  
  const addr = signer.address
  console.log('signer:', addr)
  
  const tests = [
    ['isRegistered', await engine.isRegistered(addr).catch(e => 'REVERT: ' + e.message.slice(0,80))],
    ['hasCreditScore', await engine.hasCreditScore(addr).catch(e => 'REVERT: ' + e.message.slice(0,80))],
    ['isScoreStale', await engine.isScoreStale(addr).catch(e => 'REVERT: ' + e.message.slice(0,80))],
    ['getPublishedScore', await engine.getPublishedScore(addr).catch(e => 'REVERT: ' + e.message.slice(0,80))],
    ['getDecryptedScore', await engine.getDecryptedScore(addr).catch(e => 'REVERT: ' + e.message.slice(0,80))],
    ['scoreComputedAt', await engine.scoreComputedAt(addr).catch(e => 'REVERT: ' + e.message.slice(0,80))],
    ['getScoreHistoryLength', await engine.getScoreHistoryLength(addr).catch(e => 'REVERT: ' + e.message.slice(0,80))],
  ]
  
  for (const [name, result] of tests) {
    console.log(`${name}:`, JSON.stringify(result))
  }
}
main().catch(console.error)
