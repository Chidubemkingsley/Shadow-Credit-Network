import hre from 'hardhat'
import { cofhejs, Encryptable } from 'cofhejs/node'

async function main() {
    console.log("Starting E2E on Fhenix Helium...")
    const [deployer] = await hre.ethers.getSigners()
    console.log("Using account:", deployer.address)
    
    // Deploy V3 Engine
    const Engine = await hre.ethers.getContractFactory('EncryptedCreditEngineV3')
    const engine = await Engine.deploy(deployer.address)
    await engine.waitForDeployment()
    const engineAddress = await engine.getAddress()
    console.log("Engine deployed at:", engineAddress)
    
    // Initialize CoFHE
    await hre.cofhe.initializeWithHardhatSigner(deployer)
    console.log("CoFHE initialized.")
    
    // Register
    const tx1 = await engine.register()
    await tx1.wait()
    console.log("User registered.")
    
    // Encrypt data
    console.log("Encrypting credit data...")
    const [encIncome] = await cofhejs.encrypt([Encryptable.uint64(100_000n)] as const)
    const [encDebt] = await cofhejs.encrypt([Encryptable.uint64(10_000n)] as const)
    const [encPaymentHistory] = await cofhejs.encrypt([Encryptable.uint32(9500n)] as const)
    const [encUtilization] = await cofhejs.encrypt([Encryptable.uint32(3000n)] as const)
    const [encAccountAge] = await cofhejs.encrypt([Encryptable.uint32(1825n)] as const)
    const [encDefaults] = await cofhejs.encrypt([Encryptable.uint32(0n)] as const)
    
    const tx2 = await engine.submitCreditData(encIncome, encDebt, encPaymentHistory, encUtilization, encAccountAge, encDefaults)
    await tx2.wait()
    console.log("Credit data submitted.")
    
    // Compute score
    const tx3 = await engine.computeCreditScore()
    await tx3.wait()
    console.log("Credit score computed.")
    
    // Read handle
    const handle = await engine.getEncryptedScore(deployer.address)
    console.log("Encrypted Score Handle:", handle)
    console.log("E2E successful!")
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
