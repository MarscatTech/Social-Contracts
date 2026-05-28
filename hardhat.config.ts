import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "0x0000000000000000000000000000000000000000000000000000000000000001";
const BSC_RPC_URL = process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org/";
const BSC_TESTNET_RPC_URL = process.env.BSC_TESTNET_RPC_URL ?? "https://data-seed-prebsc-1-s1.binance.org:8545/";
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    bsc: {
      url: BSC_RPC_URL,
      chainId: 56,
      accounts: [PRIVATE_KEY],
    },
    bscTestnet: {
      url: BSC_TESTNET_RPC_URL,
      chainId: 97,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    apiKey: {
      bsc: BSCSCAN_API_KEY,
      bscTestnet: BSCSCAN_API_KEY,
    },
  },
};

export default config;
