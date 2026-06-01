import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Redeploying ScoreGatedGovernance with account:", deployer.address);
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  const deploymentsPath = path.join(__dirname, "..", "deployments", "arb-sepolia.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const engineAddr = deployments.EncryptedCreditEngineV3;
  const poolAddr = deployments.PrivateLoanPoolV3;
  if (!engineAddr) throw new Error("EncryptedCreditEngineV3 not found");

  console.log("\nDeploying ScoreGatedGovernance (voluntary reveal edition)...");
  const Gov = await ethers.getContractFactory("ScoreGatedGovernance");
  const gov = await Gov.deploy(deployer.address, engineAddr, poolAddr || ethers.ZeroAddress);
  await gov.waitForDeployment();
  const govAddr = await gov.getAddress();
  console.log("Deployed at:", govAddr);

  deployments.ScoreGatedGovernance = govAddr;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("Updated deployments/arb-sepolia.json");

  const envPath = path.join(__dirname, "..", "frontend", ".env.local");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");
    if (envContent.includes("VITE_GOVERNANCE_ADDRESS")) {
      envContent = envContent.replace(/VITE_GOVERNANCE_ADDRESS=.*/, `VITE_GOVERNANCE_ADDRESS=${govAddr}`);
    } else {
      envContent += `\nVITE_GOVERNANCE_ADDRESS=${govAddr}\n`;
    }
    fs.writeFileSync(envPath, envContent);
    console.log("Updated frontend/.env.local");
  }

  // Re-authorize the new governance contract on the credit engine
  console.log("\nRe-authorizing on credit engine...");
  const engine = await ethers.getContractAt("EncryptedCreditEngineV3", engineAddr);
  const tx = await engine.addAuthorizedContract(govAddr);
  await tx.wait();
  console.log("Authorized");

  console.log("\nDone! New governance address:", govAddr);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
