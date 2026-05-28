import { expect } from "chai";
import { ethers } from "hardhat";
import { MarscatPoints } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("MarscatPoints", function () {
  let contract: MarscatPoints;
  let owner: HardhatEthersSigner;
  let signerWallet: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const PACKAGE_ID = 1;
  const PACKAGE_PRICE = ethers.parseUnits("100", 0); // 100 points
  const PACKAGE_DURATION = 90n * 24n * 60n * 60n; // 90 days in seconds

  async function signClaimPoints(
    signer: HardhatEthersSigner,
    contractAddr: string,
    user: string,
    amount: bigint,
    nonce: bigint
  ): Promise<string> {
    const domain = {
      name: "MarscatPoints",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: contractAddr,
    };
    const types = {
      ClaimPoints: [
        { name: "user", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };
    return signer.signTypedData(domain, types, { user, amount, nonce });
  }

  beforeEach(async function () {
    [owner, signerWallet, user, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MarscatPoints");
    contract = await Factory.deploy(signerWallet.address);
    await contract.waitForDeployment();

    await contract.setPackagePrice(PACKAGE_ID, PACKAGE_PRICE);
    await contract.setPackageDuration(PACKAGE_ID, PACKAGE_DURATION);
  });

  // ─── claimPoints ───────────────────────────────────────────────────────────
  describe("claimPoints", function () {
    it("should credit points with valid signature", async function () {
      const amount = 200n;
      const nonce = await contract.nonces(user.address);
      const sig = await signClaimPoints(signerWallet, await contract.getAddress(), user.address, amount, nonce);

      await contract.connect(user).claimPoints(amount, nonce, sig);

      expect(await contract.balanceOf(user.address)).to.equal(amount);
      expect(await contract.nonces(user.address)).to.equal(1n);
    });

    it("should emit PointsClaimed event", async function () {
      const amount = 200n;
      const nonce = await contract.nonces(user.address);
      const sig = await signClaimPoints(signerWallet, await contract.getAddress(), user.address, amount, nonce);

      await expect(contract.connect(user).claimPoints(amount, nonce, sig))
        .to.emit(contract, "PointsClaimed")
        .withArgs(user.address, amount, amount, 1n);
    });

    it("should accumulate points on multiple claims", async function () {
      for (let i = 0; i < 3; i++) {
        const nonce = await contract.nonces(user.address);
        const sig = await signClaimPoints(signerWallet, await contract.getAddress(), user.address, 100n, nonce);
        await contract.connect(user).claimPoints(100n, nonce, sig);
      }
      expect(await contract.balanceOf(user.address)).to.equal(300n);
    });

    it("should revert with amount == 0", async function () {
      const nonce = await contract.nonces(user.address);
      const sig = await signClaimPoints(signerWallet, await contract.getAddress(), user.address, 0n, nonce);
      await expect(contract.connect(user).claimPoints(0n, nonce, sig))
        .to.be.revertedWith("Amount must be greater than 0");
    });

    it("should revert with wrong nonce", async function () {
      const sig = await signClaimPoints(signerWallet, await contract.getAddress(), user.address, 100n, 99n);
      await expect(contract.connect(user).claimPoints(100n, 99n, sig))
        .to.be.revertedWith("Invalid nonce");
    });

    it("should revert with invalid signature (wrong signer)", async function () {
      const nonce = await contract.nonces(user.address);
      const sig = await signClaimPoints(other, await contract.getAddress(), user.address, 100n, nonce);
      await expect(contract.connect(user).claimPoints(100n, nonce, sig))
        .to.be.revertedWith("Invalid signature");
    });

    it("should revert when paused", async function () {
      await contract.pause();
      const nonce = await contract.nonces(user.address);
      const sig = await signClaimPoints(signerWallet, await contract.getAddress(), user.address, 100n, nonce);
      await expect(contract.connect(user).claimPoints(100n, nonce, sig))
        .to.be.revertedWithCustomError(contract, "EnforcedPause");
    });

    it("should prevent replay attack with same signature", async function () {
      const nonce = await contract.nonces(user.address);
      const sig = await signClaimPoints(signerWallet, await contract.getAddress(), user.address, 100n, nonce);
      await contract.connect(user).claimPoints(100n, nonce, sig);
      await expect(contract.connect(user).claimPoints(100n, nonce, sig))
        .to.be.revertedWith("Invalid nonce");
    });
  });

  // ─── rechargeWithPoints ────────────────────────────────────────────────────
  describe("rechargeWithPoints", function () {
    async function givePoints(target: HardhatEthersSigner, amount: bigint) {
      const nonce = await contract.nonces(target.address);
      const sig = await signClaimPoints(signerWallet, await contract.getAddress(), target.address, amount, nonce);
      await contract.connect(target).claimPoints(amount, nonce, sig);
    }

    it("should deduct points and record subscription (new)", async function () {
      await givePoints(user, 200n);
      const before = BigInt(await time.latest());
      await contract.connect(user).rechargeWithPoints(PACKAGE_ID, other.address);

      expect(await contract.balanceOf(user.address)).to.equal(100n);
      const expiredAt = await contract.getExpiredAt(other.address);
      expect(expiredAt).to.be.gt(before);
      const expected = before + PACKAGE_DURATION;
      expect(expiredAt).to.be.gte(expected - 5n);
      expect(expiredAt).to.be.lte(expected + 5n);
    });

    it("should extend subscription if not yet expired", async function () {
      await givePoints(user, 300n);
      await contract.connect(user).rechargeWithPoints(PACKAGE_ID, other.address);
      const firstExpiry = await contract.getExpiredAt(other.address);

      await contract.connect(user).rechargeWithPoints(PACKAGE_ID, other.address);
      const secondExpiry = await contract.getExpiredAt(other.address);

      expect(secondExpiry).to.equal(firstExpiry + PACKAGE_DURATION);
    });

    it("should restart subscription if expired", async function () {
      await givePoints(user, 300n);
      await contract.connect(user).rechargeWithPoints(PACKAGE_ID, other.address);

      await time.increase(PACKAGE_DURATION + 1n);

      const beforeSecond = BigInt(await time.latest());
      await contract.connect(user).rechargeWithPoints(PACKAGE_ID, other.address);
      const expiredAt = await contract.getExpiredAt(other.address);
      const expected = beforeSecond + PACKAGE_DURATION;
      expect(expiredAt).to.be.gte(expected - 5n);
      expect(expiredAt).to.be.lte(expected + 5n);
    });

    it("should allow recharging to self", async function () {
      await givePoints(user, 200n);
      await expect(contract.connect(user).rechargeWithPoints(PACKAGE_ID, user.address)).to.not.be.reverted;
      expect(await contract.getExpiredAt(user.address)).to.be.gt(0n);
    });

    it("should revert with insufficient points", async function () {
      await givePoints(user, 50n);
      await expect(contract.connect(user).rechargeWithPoints(PACKAGE_ID, other.address))
        .to.be.revertedWith("Insufficient points balance");
    });

    it("should revert when package price not set", async function () {
      await givePoints(user, 200n);
      await expect(contract.connect(user).rechargeWithPoints(99, other.address))
        .to.be.revertedWith("Package price not set");
    });

    it("should revert when package duration not set", async function () {
      await contract.setPackagePrice(2, 100n);
      await givePoints(user, 200n);
      await expect(contract.connect(user).rechargeWithPoints(2, other.address))
        .to.be.revertedWith("Package duration not set");
    });

    it("should revert with zero rechargeAddress", async function () {
      await givePoints(user, 200n);
      await expect(contract.connect(user).rechargeWithPoints(PACKAGE_ID, ethers.ZeroAddress))
        .to.be.revertedWith("Invalid recharge address");
    });

    it("should revert when paused", async function () {
      await givePoints(user, 200n);
      await contract.pause();
      await expect(contract.connect(user).rechargeWithPoints(PACKAGE_ID, other.address))
        .to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  // ─── Admin functions ───────────────────────────────────────────────────────
  describe("setSigner", function () {
    it("should update signer", async function () {
      await contract.setSigner(other.address);
      expect(await contract.signer()).to.equal(other.address);
    });

    it("should emit SignerUpdated", async function () {
      await expect(contract.setSigner(other.address))
        .to.emit(contract, "SignerUpdated")
        .withArgs(signerWallet.address, other.address);
    });

    it("should revert with zero address", async function () {
      await expect(contract.setSigner(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid signer address");
    });

    it("should revert when called by non-owner", async function () {
      await expect(contract.connect(user).setSigner(other.address))
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("setPackagePrice", function () {
    it("should set price and emit event", async function () {
      await expect(contract.setPackagePrice(2, 500n))
        .to.emit(contract, "PackagePriceUpdated")
        .withArgs(2, 500n);
      expect(await contract.packagePrices(2)).to.equal(500n);
    });

    it("should revert with amount == 0", async function () {
      await expect(contract.setPackagePrice(2, 0n))
        .to.be.revertedWith("Amount must be greater than 0");
    });

    it("should revert when called by non-owner", async function () {
      await expect(contract.connect(user).setPackagePrice(2, 500n))
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("setPackageDuration", function () {
    it("should set duration and emit event", async function () {
      await expect(contract.setPackageDuration(2, 86400n))
        .to.emit(contract, "PackageDurationUpdated")
        .withArgs(2, 86400n);
      expect(await contract.packageDurations(2)).to.equal(86400n);
    });

    it("should revert with duration == 0", async function () {
      await expect(contract.setPackageDuration(2, 0n))
        .to.be.revertedWith("Duration must be greater than 0");
    });

    it("should revert when called by non-owner", async function () {
      await expect(contract.connect(user).setPackageDuration(2, 86400n))
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("pause / unpause", function () {
    it("should pause and unpause", async function () {
      await contract.pause();
      expect(await contract.paused()).to.be.true;
      await contract.unpause();
      expect(await contract.paused()).to.be.false;
    });

    it("should revert pause when called by non-owner", async function () {
      await expect(contract.connect(user).pause())
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });
});
