import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

const EncryptedCreditEngineModule = buildModule('EncryptedCreditEngineModule', (m) => {
	const feeReceiver = m.getParameter('feeReceiver', m.getAccount(0))

	const engine = m.contract('EncryptedCreditEngine', [feeReceiver])

	return { engine }
})

export default EncryptedCreditEngineModule
