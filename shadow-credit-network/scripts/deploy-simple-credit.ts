import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying SimpleCreditEngine with account:", deployer.address);
  console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

  const SimpleCreditEngine = await ethers.getContractFactory("SimpleCreditEngine");
  const engine = await SimpleCreditEngine.deploy(deployer.address);
  await engine.waitForDeployment();

  const address = await engine.getAddress();
  console.log("SimpleCreditEngine deployed to:", address);

  // Verify deployment
  const isRegistered = await engine.isRegistered(deployer.address);
  console.log("Deployer registered:", isRegistered);

  // Save to deployments file
  const fs = require("fs");
  const path = require("path");
  const deploymentsPath = path.join(__dirname, "..", "deployments", "base-sepolia.json");
  let deployments = {};
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }
  deployments.SimpleCreditEngine = address;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("Saved to deployments/base-sepolia.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
