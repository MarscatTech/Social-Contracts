# Marscat Social Contract

Smart contracts for the Marscat social platform on BSC, including a points/membership subscription system and a red packet system.

## Contracts

### MarscatPoints — Points + Membership Subscription

| Function | Role | Description |
|----------|------|-------------|
| `claimPoints(amount, nonce, signature)` | User | Claim points via backend EIP-712 signature |
| `rechargeWithPoints(packageId, address)` | User | Spend points to purchase a membership subscription for a given address |
| `balanceOf(address)` | Query | Query points balance |
| `getExpiredAt(address)` | Query | Query subscription expiration time |
| `getPackageIds()` | Query | Query all configured package IDs |
| `setPackagePrice(packageId, amount)` | Owner | Set package points price |
| `setPackageDuration(packageId, duration)` | Owner | Set package subscription duration (in seconds) |
| `removePackage(packageId)` | Owner | Remove a package |
| `setSigner(address)` | Owner | Change the signer wallet |
| `pause()` / `unpause()` | Owner | Pause/resume the contract |

### MarscatRedPacket — Red Packet

| Function | Role | Description |
|----------|------|-------------|
| `createRedPacket(token, amount, claimKey)` | User | Create an ERC20 red packet |
| `createNativeRedPacket(claimKey)` | User | Create a BNB red packet (with msg.value) |
| `claimRedPacket(redPacketId, signature)` | User | Claim a red packet (requires temporary key signature) |
| `revokeRedPacket(redPacketId)` | Sender | Revoke an unclaimed red packet after 24 hours |
| `getRedPacket(redPacketId)` | Query | Query a single red packet |
| `getRedPackets(redPacketIds)` | Query | Batch query red packets |
| `pause()` / `unpause()` | Owner | Pause/resume the contract (revoke is not affected by pause) |

## Tech Stack

- Solidity 0.8.28 (EVM: cancun)
- Hardhat + TypeScript
- OpenZeppelin 5.x
- Target networks: BSC Mainnet (chainId 56) / BSC Testnet (chainId 97)

## Quick Start

```bash
npm install
npm run compile
npm test
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```env
PRIVATE_KEY=0x...                # Deployer wallet private key
BSC_RPC_URL=...                  # BSC Mainnet RPC (has default, can be left as-is)
BSC_TESTNET_RPC_URL=...          # BSC Testnet RPC (has default, can be left as-is)
BSCSCAN_API_KEY=...              # BscScan API Key, required for contract verification
POINTS_SIGNER_ADDRESS=0x...      # Backend wallet address for signing points, required when deploying Points
MARSCAT_POINTS_ADDRESS=0x...     # MarscatPoints contract address, fill in after deployment
MARSCAT_RED_PACKET_ADDRESS=0x... # MarscatRedPacket contract address, fill in after deployment

# Package config (JSON array: [id, price, duration_days])
# id: package ID (1-255), price: points price, duration_days: subscription days
PACKAGES=[[1,10000,7],[2,30000,30]]
```

## Deployment

### 1. Deploy Contracts

```bash
# Testnet
npm run deploy:points:testnet
npm run deploy:redpacket:testnet

# Mainnet
npm run deploy:points:mainnet
npm run deploy:redpacket:mainnet
```

After deployment, fill in the output contract addresses into `.env` for `MARSCAT_POINTS_ADDRESS` and `MARSCAT_RED_PACKET_ADDRESS`.

### 2. Initialize Packages

```bash
# Testnet
npm run setup:packages:testnet

# Mainnet
npm run setup:packages:mainnet
```

### 3. Verify Contracts (BscScan Open Source)

```bash
# Testnet
npm run verify:points:testnet
npm run verify:redpacket:testnet

# Mainnet
npm run verify:points:mainnet
npm run verify:redpacket:mainnet
```

## All NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile contracts |
| `npm test` | Run all tests |
| `npm run deploy:points:testnet` | Deploy MarscatPoints to testnet |
| `npm run deploy:points:mainnet` | Deploy MarscatPoints to mainnet |
| `npm run deploy:redpacket:testnet` | Deploy MarscatRedPacket to testnet |
| `npm run deploy:redpacket:mainnet` | Deploy MarscatRedPacket to mainnet |
| `npm run setup:packages:testnet` | Initialize package config (testnet) |
| `npm run setup:packages:mainnet` | Initialize package config (mainnet) |
| `npm run verify:points:testnet` | Verify MarscatPoints (testnet) |
| `npm run verify:points:mainnet` | Verify MarscatPoints (mainnet) |
| `npm run verify:redpacket:testnet` | Verify MarscatRedPacket (testnet) |
| `npm run verify:redpacket:mainnet` | Verify MarscatRedPacket (mainnet) |

## Project Structure

```
contracts/
├── MarscatPoints.sol        # Points + membership subscription contract
├── MarscatRedPacket.sol     # Red packet contract
└── test/MockERC20.sol       # Mock ERC20 for testing
scripts/
├── deployPoints.ts          # Deploy MarscatPoints
├── deployRedPacket.ts       # Deploy MarscatRedPacket
├── setupPackages.ts         # Initialize package config
├── verifyPoints.ts          # Verify MarscatPoints
└── verifyRedPacket.ts       # Verify MarscatRedPacket
test/
├── MarscatPoints.test.ts    # MarscatPoints unit tests
└── MarscatRedPacket.test.ts # MarscatRedPacket unit tests
```
