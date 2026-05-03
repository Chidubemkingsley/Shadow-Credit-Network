const { ethers } = require("hardhat");

async function main() {
  const address = "0x0A2AB73CB8311aFD261Ab92137ff70E9Ca268d69";
  const abi = [
    "function totalPoolLiquidity() view returns (uint256)",
    "function getAvailableLiquidity() view returns (uint256)",
    "function loanCount() view returns (uint256)",
    "function loans(uint256) view returns (address, uint256, uint256, uint256, uint256, uint256, uint256, bool, bool, uint8)"
  ];
  
  const provider = ethers.provider;
  const contract = new ethers.Contract(address, abi, provider);
  
  console.log("Contract:", address);
  console.log("totalPoolLiquidity:", (await contract.totalPoolLiquidity()).toString());
  console.log("getAvailableLiquidity:", (await contract.getAvailableLiquidity()).toString());
  console.log("loanCount:", (await contract.loanCount()).toString());
  
  const loanCount = await contract.loanCount();
  if (loanCount > 0) {
    for (let i = 0; i < loanCount; i++) {
      const loan = await contract.loans(i);
      console.log(`Loan ${i}:`, {
        borrower: loan[0],
        principal: loan[1].toString(),
        status: loan[6]
      });
    }
  }
}

main().catch(console.error);
