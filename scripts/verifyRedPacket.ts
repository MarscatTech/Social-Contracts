import { run } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const contractAddress = process.env.MARSCAT_RED_PACKET_ADDRESS;
  if (!contractAddress) throw new Error("MARSCAT_RED_PACKET_ADDRESS not set in .env");

  console.log("Verifying MarscatRedPacket at:", contractAddress);

  await run("verify:verify", {
    address: contractAddress,
    constructorArguments: [],
  });

  console.log("Verification complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
