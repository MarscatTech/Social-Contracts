import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const signerAddress = process.env.POINTS_SIGNER_ADDRESS;
  if (!signerAddress) throw new Error("POINTS_SIGNER_ADDRESS not set in .env");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying MarscatPoints with account:", deployer.address);

  const Factory = await ethers.getContractFactory("MarscatPoints");
  const contract = await Factory.deploy(signerAddress);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("MarscatPoints deployed to:", address);
  console.log("Set MARSCAT_POINTS_ADDRESS=" + address + " in your .env");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
