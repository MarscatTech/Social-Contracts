import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

// Parse package config from env
// Format: PACKAGES=[[id, price, duration_days], ...]
// id: package ID (1-255), price: points price, duration_days: subscription days
function parsePackages() {
  const raw = process.env.PACKAGES;
  if (!raw) throw new Error("PACKAGES not set in .env");

  const arr: [number, number, number][] = JSON.parse(raw);
  return arr.map(([id, price, days]) => ({
    id,
    price: BigInt(price),
    duration: BigInt(days) * 24n * 60n * 60n,
  }));
}

async function main() {
  const contractAddress = process.env.MARSCAT_POINTS_ADDRESS?.trim();
  if (!contractAddress) throw new Error("MARSCAT_POINTS_ADDRESS not set in .env");
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error(`MARSCAT_POINTS_ADDRESS is not a valid address: "${contractAddress}"`);
  }

  const packages = parsePackages();
  const [owner] = await ethers.getSigners();
  console.log("Setting packages with account:", owner.address);

  const contract = await ethers.getContractAt("MarscatPoints", contractAddress);

  for (const pkg of packages) {
    const tx1 = await contract.setPackagePrice(pkg.id, pkg.price);
    await tx1.wait();
    console.log(`Package ${pkg.id}: price set to ${pkg.price}`);

    const tx2 = await contract.setPackageDuration(pkg.id, pkg.duration);
    await tx2.wait();
    console.log(`Package ${pkg.id}: duration set to ${Number(pkg.duration) / 86400} days`);
  }

  console.log("All packages configured.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
