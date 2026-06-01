import { ethers } from "hardhat";

async function main() {
  const poolAddress = "0xb0c432BA998787583C5D94C423c9F8A8705C7925";
  const pool = await ethers.getContractAt("MultiAssetLoanPool", poolAddress);
  const count = await pool.getAssetCount();
  
  console.log(`Pool has ${count} assets:`);
  for (let i = 0; i < count; i++) {
    const addr = await pool.assetList(i);
    const asset = await pool.assets(addr);
    console.log(`- ${asset.symbol}: ${addr} (${asset.decimals} decimals)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
