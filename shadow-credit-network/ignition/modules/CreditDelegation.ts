import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

const CreditDelegationModule = buildModule('CreditDelegationModule', (m) => {
	const owner = m.getParameter('owner', m.getAccount(0))
	const feeReceiver = m.getParameter('feeReceiver', m.getAccount(0))

	const delegation = m.contract('CreditDelegation', [owner, feeReceiver])

	return { delegation }
})

export default CreditDelegationModule
