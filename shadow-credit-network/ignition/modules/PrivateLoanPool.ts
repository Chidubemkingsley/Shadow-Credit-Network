import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

const PrivateLoanPoolModule = buildModule('PrivateLoanPoolModule', (m) => {
	const owner = m.getParameter('owner', m.getAccount(0))
	const feeReceiver = m.getParameter('feeReceiver', m.getAccount(0))

	const pool = m.contract('PrivateLoanPool', [owner, feeReceiver])

	return { pool }
})

export default PrivateLoanPoolModule
