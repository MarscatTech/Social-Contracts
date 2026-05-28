// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MarscatPoints is Ownable, ReentrancyGuard, Pausable, EIP712 {
    using ECDSA for bytes32;

    // ─── Storage ───────────────────────────────────────────────────────────────
    mapping(address => uint256) private _balances;
    mapping(address => uint256) public nonces;
    mapping(uint8 => uint256) public packagePrices;
    mapping(uint8 => uint256) public packageDurations;
    mapping(address => uint256) public subscriptions;
    address public signer;
    uint8[] private _packageIds;

    // ─── EIP-712 type hash ─────────────────────────────────────────────────────
    bytes32 private constant _CLAIM_POINTS_TYPEHASH =
        keccak256("ClaimPoints(address user,uint256 amount,uint256 nonce)");

    // ─── Events ────────────────────────────────────────────────────────────────
    event PointsClaimed(address indexed user, uint256 amount, uint256 newBalance, uint256 newNonce);
    event Recharged(address indexed sender, address indexed rechargeAddress, uint8 indexed packageId, uint256 pointsSpent, uint256 expiredAt);
    event PackagePriceUpdated(uint8 indexed packageId, uint256 amount);
    event PackageDurationUpdated(uint8 indexed packageId, uint256 duration);
    event PackageRemoved(uint8 indexed packageId);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);

    // ─── Constructor ───────────────────────────────────────────────────────────
    constructor(address initialSigner) Ownable(msg.sender) EIP712("MarscatPoints", "1") {
        require(initialSigner != address(0), "Invalid signer address");
        signer = initialSigner;
    }

    // ─── User functions ────────────────────────────────────────────────────────
    function claimPoints(
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be greater than 0");
        require(nonce == nonces[msg.sender], "Invalid nonce");

        bytes32 structHash = keccak256(abi.encode(_CLAIM_POINTS_TYPEHASH, msg.sender, amount, nonce));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, signature);
        require(recovered == signer, "Invalid signature");

        _balances[msg.sender] += amount;
        nonces[msg.sender] += 1;

        emit PointsClaimed(msg.sender, amount, _balances[msg.sender], nonces[msg.sender]);
    }

    function rechargeWithPoints(
        uint8 packageId,
        address rechargeAddress
    ) external nonReentrant whenNotPaused {
        require(rechargeAddress != address(0), "Invalid recharge address");

        uint256 price = packagePrices[packageId];
        uint256 duration = packageDurations[packageId];
        require(price > 0, "Package price not set");
        require(duration > 0, "Package duration not set");
        require(_balances[msg.sender] >= price, "Insufficient points balance");

        _balances[msg.sender] -= price;

        uint256 current = subscriptions[rechargeAddress];
        if (current == 0 || block.timestamp >= current) {
            subscriptions[rechargeAddress] = block.timestamp + duration;
        } else {
            subscriptions[rechargeAddress] = current + duration;
        }

        emit Recharged(msg.sender, rechargeAddress, packageId, price, subscriptions[rechargeAddress]);
    }

    function balanceOf(address user) external view returns (uint256) {
        return _balances[user];
    }

    function getExpiredAt(address user) external view returns (uint256) {
        return subscriptions[user];
    }

    function getPackageIds() external view returns (uint8[] memory) {
        return _packageIds;
    }

    // ─── Admin functions ───────────────────────────────────────────────────────
    function setSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Invalid signer address");
        address oldSigner = signer;
        signer = newSigner;
        emit SignerUpdated(oldSigner, newSigner);
    }

    function setPackagePrice(uint8 packageId, uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be greater than 0");
        if (packagePrices[packageId] == 0 && packageDurations[packageId] == 0) {
            _packageIds.push(packageId);
        }
        packagePrices[packageId] = amount;
        emit PackagePriceUpdated(packageId, amount);
    }

    function setPackageDuration(uint8 packageId, uint256 duration) external onlyOwner {
        require(duration > 0, "Duration must be greater than 0");
        if (packagePrices[packageId] == 0 && packageDurations[packageId] == 0) {
            _packageIds.push(packageId);
        }
        packageDurations[packageId] = duration;
        emit PackageDurationUpdated(packageId, duration);
    }

    function removePackage(uint8 packageId) external onlyOwner {
        require(packagePrices[packageId] > 0 || packageDurations[packageId] > 0, "Package not found");
        packagePrices[packageId] = 0;
        packageDurations[packageId] = 0;
        for (uint256 i = 0; i < _packageIds.length; i++) {
            if (_packageIds[i] == packageId) {
                _packageIds[i] = _packageIds[_packageIds.length - 1];
                _packageIds.pop();
                break;
            }
        }
        emit PackageRemoved(packageId);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
