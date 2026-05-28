import { expect } from "chai";
import { ethers } from "hardhat";
import { MarscatRedPacket } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("MarscatRedPacket", function () {
  let contract: MarscatRedPacket;
  let owner: HardhatEthersSigner;
  let sender: HardhatEthersSigner;
  let receiver: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;

  async function makeClaimSignature(
    claimPrivKey: string,
    receiverAddress: string,
    redPacketId: string
  ): Promise<string> {
    const wallet = new ethers.Wallet(claimPrivKey);
    const msgHash = ethers.keccak256(
      ethers.solidityPacked(["address", "bytes32"], [receiverAddress, redPacketId])
    );
    return wallet.signMessage(ethers.getBytes(msgHash));
  }

  async function createNativePacket(
    sdr: HardhatEthersSigner,
    amount: bigint
  ): Promise<{ redPacketId: string; ephemeralPrivKey: string }> {
    const ephemeral = ethers.Wallet.createRandom();
    const tx = await contract.connect(sdr).createNativeRedPacket(ephemeral.address, { value: amount });
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
      .find((e) => e?.name === "RedPacketCreated");
    return { redPacketId: event!.args.redPacketId, ephemeralPrivKey: ephemeral.privateKey };
  }

  beforeEach(async function () {
    [owner, sender, receiver, attacker] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MarscatRedPacket");
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  // ─── createNativeRedPacket ─────────────────────────────────────────────────
  describe("createNativeRedPacket", function () {
    it("should create a BNB red packet and emit event", async function () {
      const ephemeral = ethers.Wallet.createRandom();
      const amount = ethers.parseEther("1");

      const tx = await contract.connect(sender).createNativeRedPacket(ephemeral.address, { value: amount });
      const receipt = await tx.wait();
      const event = receipt!.logs
        .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
        .find((e) => e?.name === "RedPacketCreated");

      expect(event).to.not.be.undefined;
      const redPacketId: string = event!.args.redPacketId;

      const rp = await contract.getRedPacket(redPacketId);
      expect(rp.sender).to.equal(sender.address);
      expect(rp.token).to.equal(ethers.ZeroAddress);
      expect(rp.amount).to.equal(amount);
      expect(rp.claimKey).to.equal(ephemeral.address);
      expect(rp.status).to.equal(0); // Pending
      expect(rp.claimedBy).to.equal(ethers.ZeroAddress);
      expect(rp.claimedBlock).to.equal(0n);
    });

    it("should revert with zero value", async function () {
      const ephemeral = ethers.Wallet.createRandom();
      await expect(contract.connect(sender).createNativeRedPacket(ephemeral.address, { value: 0 }))
        .to.be.revertedWith("Amount must be greater than 0");
    });

    it("should revert with zero claimKey", async function () {
      await expect(
        contract.connect(sender).createNativeRedPacket(ethers.ZeroAddress, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("Invalid claim key");
    });

    it("should revert when paused", async function () {
      await contract.pause();
      const ephemeral = ethers.Wallet.createRandom();
      await expect(
        contract.connect(sender).createNativeRedPacket(ephemeral.address, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  // ─── createRedPacket (ERC20) ───────────────────────────────────────────────
  describe("createRedPacket (ERC20)", function () {
    it("should create an ERC20 red packet", async function () {
      const MockFactory = await ethers.getContractFactory("MockERC20");
      const token = await MockFactory.deploy();
      await token.waitForDeployment();
      const tokenAddr = await token.getAddress();
      const contractAddr = await contract.getAddress();
      const amount = ethers.parseEther("5");

      await token.connect(sender).mint(sender.address, ethers.parseEther("10"));
      await token.connect(sender).approve(contractAddr, ethers.parseEther("10"));

      const ephemeral = ethers.Wallet.createRandom();
      const tx = await contract.connect(sender).createRedPacket(tokenAddr, amount, ephemeral.address);
      const receipt = await tx.wait();
      const event = receipt!.logs
        .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
        .find((e) => e?.name === "RedPacketCreated");

      expect(event).to.not.be.undefined;
      const rp = await contract.getRedPacket(event!.args.redPacketId);
      expect(rp.token).to.equal(tokenAddr);
      expect(rp.amount).to.equal(amount);
      expect(rp.status).to.equal(0); // Pending
    });

    it("should revert with zero token address", async function () {
      const ephemeral = ethers.Wallet.createRandom();
      await expect(contract.connect(sender).createRedPacket(ethers.ZeroAddress, 100n, ephemeral.address))
        .to.be.revertedWith("Invalid token address");
    });

    it("should revert with zero amount", async function () {
      const MockFactory = await ethers.getContractFactory("MockERC20");
      const token = await MockFactory.deploy();
      await token.waitForDeployment();
      const ephemeral = ethers.Wallet.createRandom();
      await expect(contract.connect(sender).createRedPacket(await token.getAddress(), 0n, ephemeral.address))
        .to.be.revertedWith("Amount must be greater than 0");
    });

    it("should revert when paused", async function () {
      await contract.pause();
      const MockFactory = await ethers.getContractFactory("MockERC20");
      const token = await MockFactory.deploy();
      await token.waitForDeployment();
      const ephemeral = ethers.Wallet.createRandom();
      await expect(contract.connect(sender).createRedPacket(await token.getAddress(), 100n, ephemeral.address))
        .to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  // ─── claimRedPacket ────────────────────────────────────────────────────────
  describe("claimRedPacket", function () {
    let redPacketId: string;
    let ephemeralPrivKey: string;
    const amount = ethers.parseEther("1");

    beforeEach(async function () {
      const result = await createNativePacket(sender, amount);
      redPacketId = result.redPacketId;
      ephemeralPrivKey = result.ephemeralPrivKey;
    });

    it("should claim BNB and update state", async function () {
      const sig = await makeClaimSignature(ephemeralPrivKey, receiver.address, redPacketId);
      const balBefore = await ethers.provider.getBalance(receiver.address);

      const tx = await contract.connect(receiver).claimRedPacket(redPacketId, sig);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balAfter = await ethers.provider.getBalance(receiver.address);
      expect(balAfter - balBefore + gasUsed).to.equal(amount);

      const rp = await contract.getRedPacket(redPacketId);
      expect(rp.status).to.equal(1); // Claimed
      expect(rp.claimedBy).to.equal(receiver.address);
      expect(rp.claimedBlock).to.equal(BigInt(receipt!.blockNumber));
    });

    it("should emit RedPacketClaimed", async function () {
      const sig = await makeClaimSignature(ephemeralPrivKey, receiver.address, redPacketId);
      const nextBlock = await ethers.provider.getBlockNumber() + 1;
      await expect(contract.connect(receiver).claimRedPacket(redPacketId, sig))
        .to.emit(contract, "RedPacketClaimed")
        .withArgs(redPacketId, receiver.address, nextBlock);
    });

    it("should revert with invalid signature (wrong receiver in sig)", async function () {
      // Signature made for attacker, but submitted by receiver — won't match
      const sig = await makeClaimSignature(ephemeralPrivKey, attacker.address, redPacketId);
      await expect(contract.connect(receiver).claimRedPacket(redPacketId, sig))
        .to.be.revertedWith("Invalid signature");
    });

    it("should prevent front-running: attacker cannot use receiver's signature", async function () {
      const sig = await makeClaimSignature(ephemeralPrivKey, receiver.address, redPacketId);
      // attacker tries to submit receiver's signature from their own address
      await expect(contract.connect(attacker).claimRedPacket(redPacketId, sig))
        .to.be.revertedWith("Invalid signature");
    });

    it("should revert when already claimed", async function () {
      const sig = await makeClaimSignature(ephemeralPrivKey, receiver.address, redPacketId);
      await contract.connect(receiver).claimRedPacket(redPacketId, sig);

      const sig2 = await makeClaimSignature(ephemeralPrivKey, receiver.address, redPacketId);
      await expect(contract.connect(receiver).claimRedPacket(redPacketId, sig2))
        .to.be.revertedWith("RedPacket already claimed or revoked");
    });

    it("should revert for non-existent redPacketId", async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      const sig = await makeClaimSignature(ephemeralPrivKey, receiver.address, fakeId);
      await expect(contract.connect(receiver).claimRedPacket(fakeId, sig))
        .to.be.revertedWith("RedPacket not found");
    });

    it("should revert when paused", async function () {
      await contract.pause();
      const sig = await makeClaimSignature(ephemeralPrivKey, receiver.address, redPacketId);
      await expect(contract.connect(receiver).claimRedPacket(redPacketId, sig))
        .to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  // ─── revokeRedPacket ───────────────────────────────────────────────────────
  describe("revokeRedPacket", function () {
    let redPacketId: string;
    let ephemeralPrivKey: string;
    const amount = ethers.parseEther("1");

    beforeEach(async function () {
      const result = await createNativePacket(sender, amount);
      redPacketId = result.redPacketId;
      ephemeralPrivKey = result.ephemeralPrivKey;
    });

    it("should revoke and refund after 24h", async function () {
      await time.increase(24 * 60 * 60 + 1);
      const balBefore = await ethers.provider.getBalance(sender.address);

      const tx = await contract.connect(sender).revokeRedPacket(redPacketId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balAfter = await ethers.provider.getBalance(sender.address);
      expect(balAfter - balBefore + gasUsed).to.equal(amount);

      const rp = await contract.getRedPacket(redPacketId);
      expect(rp.status).to.equal(2); // Revoked
    });

    it("should emit RedPacketRevoked", async function () {
      await time.increase(24 * 60 * 60 + 1);
      await expect(contract.connect(sender).revokeRedPacket(redPacketId))
        .to.emit(contract, "RedPacketRevoked")
        .withArgs(redPacketId, sender.address, anyValue);
    });

    it("should revert before 24h", async function () {
      await time.increase(60 * 60); // only 1h
      await expect(contract.connect(sender).revokeRedPacket(redPacketId))
        .to.be.revertedWith("Cannot revoke before 24 hours");
    });

    it("should revert when called by non-sender", async function () {
      await time.increase(24 * 60 * 60 + 1);
      await expect(contract.connect(attacker).revokeRedPacket(redPacketId))
        .to.be.revertedWith("Not the sender");
    });

    it("should revert when already claimed", async function () {
      const sig = await makeClaimSignature(ephemeralPrivKey, receiver.address, redPacketId);
      await contract.connect(receiver).claimRedPacket(redPacketId, sig);

      await time.increase(24 * 60 * 60 + 1);
      await expect(contract.connect(sender).revokeRedPacket(redPacketId))
        .to.be.revertedWith("RedPacket not pending");
    });

    it("should be revocable even when contract is paused", async function () {
      await time.increase(24 * 60 * 60 + 1);
      await contract.pause();
      await expect(contract.connect(sender).revokeRedPacket(redPacketId)).to.not.be.reverted;
    });
  });

  // ─── getRedPackets (batch query) ───────────────────────────────────────────
  describe("getRedPackets", function () {
    it("should return multiple red packets", async function () {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const result = await createNativePacket(sender, ethers.parseEther("0.1"));
        ids.push(result.redPacketId);
      }
      const results = await contract.getRedPackets(ids);
      expect(results.length).to.equal(3);
      results.forEach((rp) => {
        expect(rp.sender).to.equal(sender.address);
        expect(rp.status).to.equal(0); // Pending
      });
    });
  });

  // ─── pause / unpause ───────────────────────────────────────────────────────
  describe("pause / unpause", function () {
    it("should pause and unpause", async function () {
      await contract.pause();
      expect(await contract.paused()).to.be.true;
      await contract.unpause();
      expect(await contract.paused()).to.be.false;
    });

    it("should revert when called by non-owner", async function () {
      await expect(contract.connect(sender).pause())
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });
});
