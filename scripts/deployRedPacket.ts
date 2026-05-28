import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying MarscatRedPacket with account:", deployer.address);

  const Factory = await ethers.getContractFactory("MarscatRedPacket");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("MarscatRedPacket deployed to:", address);
  console.log("Set MARSCAT_RED_PACKET_ADDRESS=" + address + " in your .env");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
