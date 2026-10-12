// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {AgentGuardVault} from "./AgentGuardVault.sol";

/// @notice Owner-signed spending mandates for AI agents, in the spirit of AP2 "intent mandates".
/// @dev An agent whose registry signer is this contract can only pay through mandates.
/// The owner signs an EIP-712 mandate off-chain (no gas): which agent key may use it, which
/// recipient, how much in total and per payment, and for how long. The agent key presents the
/// mandate here; this contract checks the owner's signature and the mandate's own budget, then
/// calls the vault, which still enforces the standing policy (approved recipients, per-payment
/// and daily limits, pause, balance, replay protection). Both layers must agree.
contract MandateExecutor is EIP712, ReentrancyGuard {
    error MandateNotYetValid(uint64 validAfter);
    error MandateExpired(uint64 validUntil);
    error MandateRevoked(bytes32 mandateHash);
    error MandateBudgetExceeded(uint256 remaining, uint256 requested);
    error MandatePerPaymentExceeded(uint256 limit, uint256 requested);
    error NotMandateAgent(address caller);
    error NotSignedByOwner(address recovered, address owner);
    error AgentNotWiredToExecutor(uint256 agentId);
    error NotAgentOwner();

    struct Mandate {
        uint256 agentId;
        address agentKey;
        address recipient;
        uint256 maxTotal;
        uint256 maxPerPayment;
        uint64 validAfter;
        uint64 validUntil;
        bytes32 purposeHash;
        uint256 nonce;
    }

    bytes32 public constant MANDATE_TYPEHASH = keccak256(
        "Mandate(uint256 agentId,address agentKey,address recipient,uint256 maxTotal,uint256 maxPerPayment,uint64 validAfter,uint64 validUntil,bytes32 purposeHash,uint256 nonce)"
    );

    AgentRegistry public immutable registry;
    AgentGuardVault public immutable vault;
    mapping(bytes32 mandateHash => uint256 spent) public spentUnder;
    mapping(bytes32 mandateHash => bool revoked) public revoked;

    event MandatePayment(
        bytes32 indexed mandateHash,
        uint256 indexed agentId,
        address indexed recipient,
        uint256 amount,
        bytes32 requestId,
        uint256 spentUnderMandate
    );
    event MandateRevokedByOwner(bytes32 indexed mandateHash, uint256 indexed agentId);

    constructor(AgentRegistry registry_, AgentGuardVault vault_) EIP712("AgentShield Mandates", "1") {
        registry = registry_;
        vault = vault_;
    }

    function mandateHash(Mandate calldata mandate) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MANDATE_TYPEHASH,
                    mandate.agentId,
                    mandate.agentKey,
                    mandate.recipient,
                    mandate.maxTotal,
                    mandate.maxPerPayment,
                    mandate.validAfter,
                    mandate.validUntil,
                    mandate.purposeHash,
                    mandate.nonce
                )
            )
        );
    }

    function remaining(Mandate calldata mandate) external view returns (uint256) {
        bytes32 digest = mandateHash(mandate);
        if (revoked[digest] || block.timestamp > mandate.validUntil) return 0;
        uint256 spent = spentUnder[digest];
        return mandate.maxTotal > spent ? mandate.maxTotal - spent : 0;
    }

    /// @notice Pays under a mandate. Only the mandate's agent key may call this.
    function execute(Mandate calldata mandate, bytes calldata ownerSignature, bytes32 requestId, uint256 amount)
        external
        nonReentrant
    {
        if (msg.sender != mandate.agentKey) revert NotMandateAgent(msg.sender);
        if (registry.authorizedSignerOf(mandate.agentId) != address(this)) {
            revert AgentNotWiredToExecutor(mandate.agentId);
        }

        bytes32 digest = mandateHash(mandate);
        address owner = registry.ownerOf(mandate.agentId);
        address signer = ECDSA.recover(digest, ownerSignature);
        if (signer != owner) revert NotSignedByOwner(signer, owner);

        if (revoked[digest]) revert MandateRevoked(digest);
        if (block.timestamp < mandate.validAfter) revert MandateNotYetValid(mandate.validAfter);
        if (block.timestamp > mandate.validUntil) revert MandateExpired(mandate.validUntil);
        if (amount > mandate.maxPerPayment) revert MandatePerPaymentExceeded(mandate.maxPerPayment, amount);
        uint256 spent = spentUnder[digest];
        if (spent + amount > mandate.maxTotal) {
            revert MandateBudgetExceeded(mandate.maxTotal > spent ? mandate.maxTotal - spent : 0, amount);
        }

        spentUnder[digest] = spent + amount;
        // The vault applies the standing policy on top and reverts the whole call if it disagrees.
        vault.executePayment(mandate.agentId, requestId, payable(mandate.recipient), amount);
        emit MandatePayment(digest, mandate.agentId, mandate.recipient, amount, requestId, spent + amount);
    }

    /// @notice The agent's owner can cancel a mandate before it expires.
    function revoke(Mandate calldata mandate) external {
        if (registry.ownerOf(mandate.agentId) != msg.sender) revert NotAgentOwner();
        bytes32 digest = mandateHash(mandate);
        revoked[digest] = true;
        emit MandateRevokedByOwner(digest, mandate.agentId);
    }
}
