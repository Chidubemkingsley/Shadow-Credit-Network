import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

const ReputationRegistryModule = buildModule('ReputationRegistryModule', (m) => {
	const owner = m.getParameter('owner', m.getAccount(0))
	const decayInterval = m.getParameter('decayInterval', 90 * 24 * 60 * 60) // 90 days
	const minAttestations = m.getParameter('minAttestations', 2)

	const registry = m.contract('ReputationRegistry', [owner, decayInterval, minAttestations])

	return { registry }
})

export default ReputationRegistryModule
