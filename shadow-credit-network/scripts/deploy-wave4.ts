import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Wave 4 contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

  // Load existing Wave 3 deployments
  const deploymentsPath = path.join(__dirname, "..", "deployments", "base-sepolia.json");
  let deployments: any = {};
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }

  const engineAddress = deployments.EncryptedCreditEngineV3;
  if (!engineAddress) {
    throw new Error("EncryptedCreditEngineV3 not found in deployments/base-sepolia.json");
  }

  // 1. Deploy ScoreGatedGovernance
  console.log("\nDeploying ScoreGatedGovernance...");
  const Governance = await ethers.getContractFactory("ScoreGatedGovernance");
  const governance = await Governance.deploy(
    deployer.address,
    engineAddress,
    deployments.PrivateLoanPoolV3 || ethers.ZeroAddress
  );
  await governance.waitForDeployment();
  const govAddress = await governance.getAddress();
  console.log("ScoreGatedGovernance deployed to:", govAddress);

  // 2. Deploy SoulboundCreditNFT
  console.log("\nDeploying SoulboundCreditNFT...");
  const CreditNFT = await ethers.getContractFactory("SoulboundCreditNFT");
  const nft = await CreditNFT.deploy(deployer.address, engineAddress);
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log("SoulboundCreditNFT deployed to:", nftAddress);

  // 3. Save to deployments
  deployments.ScoreGatedGovernance = govAddress;
  deployments.SoulboundCreditNFT = nftAddress;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\nSaved to deployments/base-sepolia.json");

  // 4. Update frontend environment
  const envPath = path.join(__dirname, "..", "frontend", ".env.local");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");
    
    // Append or replace the Wave 4 variables
    if (envContent.includes("VITE_GOVERNANCE_ADDRESS")) {
      envContent = envContent.replace(/VITE_GOVERNANCE_ADDRESS=.*/, `VITE_GOVERNANCE_ADDRESS=${govAddress}`);
    } else {
      envContent += `\n# ── Wave 4 Contracts (deployed ${new Date().toISOString().split('T')[0]}) ────────────────────────────────────\n`;
      envContent += `VITE_GOVERNANCE_ADDRESS=${govAddress}\n`;
    }

    if (envContent.includes("VITE_CREDIT_NFT_ADDRESS")) {
      envContent = envContent.replace(/VITE_CREDIT_NFT_ADDRESS=.*/, `VITE_CREDIT_NFT_ADDRESS=${nftAddress}`);
    } else {
      envContent += `VITE_CREDIT_NFT_ADDRESS=${nftAddress}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log("Updated frontend/.env.local with Wave 4 addresses.");
  } else {
    console.warn("frontend/.env.local not found, skipping environment update.");
  }

  console.log("\nWave 4 Deployment Complete! ✅");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
