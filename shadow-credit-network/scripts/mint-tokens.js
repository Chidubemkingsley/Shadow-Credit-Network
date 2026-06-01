async function main() {
  const [deployer] = await ethers.getSigners();
  const userAddress = "0x90356CF97B3BF1749A604d3F89b3DF3602A459E3";
  const amount = ethers.parseUnits("100", 18);

  console.log("Minting 100 WETH...");
  const weth = await ethers.getContractAt("TestERC20", "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73");
  const tx1 = await weth.mint(userAddress, amount);
  await tx1.wait();
  console.log("WETH Minted:", tx1.hash);

  console.log("Minting 100 SCT...");
  const sct = await ethers.getContractAt("TestERC20", "0x53F6519588372fB94307338aF226868f43c204F6");
  const tx2 = await sct.mint(userAddress, amount);
  await tx2.wait();
  console.log("SCT Minted:", tx2.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
