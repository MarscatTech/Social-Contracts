// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MarscatRedPacket is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ─── Types ─────────────────────────────────────────────────────────────────
    enum RedPacketStatus { Pending, Claimed, Revoked }

    struct RedPacket {
        address sender;
        address token;
        uint256 amount;
        address claimKey;
        uint256 createdAt;
        RedPacketStatus status;
        address claimedBy;
        uint256 claimedBlock;
    }

    // ─── Storage ───────────────────────────────────────────────────────────────
    mapping(bytes32 => RedPacket) public redPackets;

    // ─── Events ────────────────────────────────────────────────────────────────
    event RedPacketCreated(bytes32 indexed redPacketId, address indexed sender, address indexed token, uint256 amount, address claimKey, uint256 createdAt);
    event RedPacketClaimed(bytes32 indexed redPacketId, address indexed claimedBy, uint256 claimedBlock);
    event RedPacketRevoked(bytes32 indexed redPacketId, address indexed sender, uint256 revokedAt);

    // ─── Constructor ───────────────────────────────────────────────────────────
    constructor() Ownable(msg.sender) {}

    // ─── Internal helpers ──────────────────────────────────────────────────────
    function _generateId(address sender, address claimKey, address token, uint256 amount) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(sender, claimKey, token, amount, block.timestamp, block.number));
    }

    function _verifyClaimSignature(bytes32 redPacketId, address claimKey, bytes calldata signature) internal view {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(msg.sender, redPacketId))
            )
        );
        address recovered = ECDSA.recover(messageHash, signature);
        require(recovered == claimKey, "Invalid signature");
    }

    // ─── User functions ────────────────────────────────────────────────────────
    function createRedPacket(
        address token,
        uint256 amount,
        address claimKey
    ) external nonReentrant whenNotPaused returns (bytes32 redPacketId) {
        require(token != address(0), "Invalid token address");
        require(amount > 0, "Amount must be greater than 0");
        require(claimKey != address(0), "Invalid claim key");

        redPacketId = _generateId(msg.sender, claimKey, token, amount);
        require(redPackets[redPacketId].createdAt == 0, "RedPacket already exists");

        redPackets[redPacketId] = RedPacket({
            sender: msg.sender,
            token: token,
            amount: amount,
            claimKey: claimKey,
            createdAt: block.timestamp,
            status: RedPacketStatus.Pending,
            claimedBy: address(0),
            claimedBlock: 0
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit RedPacketCreated(redPacketId, msg.sender, token, amount, claimKey, block.timestamp);
    }

    function createNativeRedPacket(
        address claimKey
    ) external payable nonReentrant whenNotPaused returns (bytes32 redPacketId) {
        require(msg.value > 0, "Amount must be greater than 0");
        require(claimKey != address(0), "Invalid claim key");

        redPacketId = _generateId(msg.sender, claimKey, address(0), msg.value);
        require(redPackets[redPacketId].createdAt == 0, "RedPacket already exists");

        redPackets[redPacketId] = RedPacket({
            sender: msg.sender,
            token: address(0),
            amount: msg.value,
            claimKey: claimKey,
            createdAt: block.timestamp,
            status: RedPacketStatus.Pending,
            claimedBy: address(0),
            claimedBlock: 0
        });

        emit RedPacketCreated(redPacketId, msg.sender, address(0), msg.value, claimKey, block.timestamp);
    }

    function claimRedPacket(
        bytes32 redPacketId,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        RedPacket storage rp = redPackets[redPacketId];
        require(rp.createdAt != 0, "RedPacket not found");
        require(rp.status == RedPacketStatus.Pending, "RedPacket already claimed or revoked");

        _verifyClaimSignature(redPacketId, rp.claimKey, signature);

        rp.status = RedPacketStatus.Claimed;
        rp.claimedBy = msg.sender;
        rp.claimedBlock = block.number;

        if (rp.token == address(0)) {
            (bool success, ) = msg.sender.call{value: rp.amount}("");
            require(success, "Native transfer failed");
        } else {
            IERC20(rp.token).safeTransfer(msg.sender, rp.amount);
        }

        emit RedPacketClaimed(redPacketId, msg.sender, block.number);
    }

    function revokeRedPacket(bytes32 redPacketId) external nonReentrant {
        RedPacket storage rp = redPackets[redPacketId];
        require(rp.sender == msg.sender, "Not the sender");
        require(rp.status == RedPacketStatus.Pending, "RedPacket not pending");
        require(block.timestamp >= rp.createdAt + 24 hours, "Cannot revoke before 24 hours");

        rp.status = RedPacketStatus.Revoked;

        if (rp.token == address(0)) {
            (bool success, ) = msg.sender.call{value: rp.amount}("");
            require(success, "Native transfer failed");
        } else {
            IERC20(rp.token).safeTransfer(msg.sender, rp.amount);
        }

        emit RedPacketRevoked(redPacketId, msg.sender, block.timestamp);
    }

    // ─── Query functions ───────────────────────────────────────────────────────
    function getRedPacket(bytes32 redPacketId) external view returns (RedPacket memory) {
        return redPackets[redPacketId];
    }

    function getRedPackets(bytes32[] calldata redPacketIds) external view returns (RedPacket[] memory) {
        RedPacket[] memory result = new RedPacket[](redPacketIds.length);
        for (uint256 i = 0; i < redPacketIds.length; i++) {
            result[i] = redPackets[redPacketIds[i]];
        }
        return result;
    }

    // ─── Admin functions ───────────────────────────────────────────────────────
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
