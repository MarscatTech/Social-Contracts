import { run } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const contractAddress = process.env.MARSCAT_POINTS_ADDRESS;
  const signerAddress = process.env.POINTS_SIGNER_ADDRESS;

  if (!contractAddress) throw new Error("MARSCAT_POINTS_ADDRESS not set in .env");
  if (!signerAddress) throw new Error("POINTS_SIGNER_ADDRESS not set in .env");

  console.log("Verifying MarscatPoints at:", contractAddress);

  await run("verify:verify", {
    address: contractAddress,
    constructorArguments: [signerAddress],
  });

  console.log("Verification complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
