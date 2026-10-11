// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentRegistry} from "./AgentRegistry.sol";

/// @notice Native-MON vault whose signer path is constrained by owner-configured policy.
/// @dev The agent signer can only execute approved payments. It cannot withdraw or call arbitrary targets.
contract AgentGuardVault is ReentrancyGuard {
    error AgentPaused(uint256 agentId);
    error DailyLimitExceeded(uint256 agentId, uint256 attempted, uint256 remaining);
    error DirectTransferNotSupported();
    error DuplicateRequest(bytes32 requestId);
    error InsufficientVaultBalance(uint256 available, uint256 requested);
    error InvalidAmount();
    error InvalidRecipient();
    error InvalidRequestId();
    error InvalidPolicy();
    error NotAgentOwner();
    error PaymentTransferFailed();
    error PerPaymentLimitExceeded(uint256 limit, uint256 requested);
    error RecipientNotApproved(address recipient);
    error UnauthorizedSigner();

    struct Policy {
        uint256 perPaymentLimit;
        uint256 dailyLimit;
        uint256 spentToday;
        uint256 dayIndex;
        uint256 version;
        bool paused;
    }

    AgentRegistry public immutable registry;
    mapping(uint256 agentId => uint256 balance) public vaultBalance;
    mapping(uint256 agentId => Policy policy) private policies;
    mapping(uint256 agentId => mapping(address recipient => bool approved))
        public approvedRecipients;
    mapping(uint256 agentId => mapping(bytes32 requestId => bool used)) public requestUsed;

    event Deposited(uint256 indexed agentId, address indexed depositor, uint256 amount);
    event Withdrawn(uint256 indexed agentId, address indexed recipient, uint256 amount);
    event PolicyUpdated(
        uint256 indexed agentId,
        uint256 perPaymentLimit,
        uint256 dailyLimit,
        uint256 policyVersion
    );
    event RecipientApprovalUpdated(
        uint256 indexed agentId,
        address indexed recipient,
        bool approved,
        uint256 policyVersion
    );
    event AgentPauseUpdated(uint256 indexed agentId, bool paused, uint256 policyVersion);
    event PaymentExecuted(
        uint256 indexed agentId,
        bytes32 indexed requestId,
        address indexed signer,
        address recipient,
        uint256 amount,
        uint256 dayIndex,
        uint256 policyVersion
    );

    constructor(address registryAddress) {
        if (registryAddress == address(0)) revert InvalidRecipient();
        registry = AgentRegistry(registryAddress);
    }

    function deposit(uint256 agentId) external payable {
        _requireAgentOwner(agentId);
        if (msg.value == 0) revert InvalidAmount();

        vaultBalance[agentId] += msg.value;
        emit Deposited(agentId, msg.sender, msg.value);
    }

    /// @dev Owner withdrawal is an administrative custody action, not an agent execution path.
    function withdraw(uint256 agentId, address payable recipient, uint256 amount)
        external
        nonReentrant
    {
        _requireAgentOwner(agentId);
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (vaultBalance[agentId] < amount) {
            revert InsufficientVaultBalance(vaultBalance[agentId], amount);
        }

        vaultBalance[agentId] -= amount;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert PaymentTransferFailed();
        emit Withdrawn(agentId, recipient, amount);
    }

    function configurePolicy(uint256 agentId, uint256 perPaymentLimit, uint256 dailyLimit)
        external
    {
        _requireAgentOwner(agentId);
        if (perPaymentLimit == 0 || dailyLimit == 0 || perPaymentLimit > dailyLimit) {
            revert InvalidPolicy();
        }

        Policy storage policy = policies[agentId];
        _rollDailyWindow(policy);
        policy.perPaymentLimit = perPaymentLimit;
        policy.dailyLimit = dailyLimit;
        uint256 policyVersion = _bumpPolicyVersion(policy);

        emit PolicyUpdated(agentId, perPaymentLimit, dailyLimit, policyVersion);
    }

    function setRecipientApproval(uint256 agentId, address recipient, bool approved)
        external
    {
        _requireAgentOwner(agentId);
        if (recipient == address(0)) revert InvalidRecipient();

        approvedRecipients[agentId][recipient] = approved;
        uint256 policyVersion = _bumpPolicyVersion(policies[agentId]);
        emit RecipientApprovalUpdated(agentId, recipient, approved, policyVersion);
    }

    function setPaused(uint256 agentId, bool paused) external {
        _requireAgentOwner(agentId);

        Policy storage policy = policies[agentId];
        policy.paused = paused;
        uint256 policyVersion = _bumpPolicyVersion(policy);
        emit AgentPauseUpdated(agentId, paused, policyVersion);
    }

    function executePayment(
        uint256 agentId,
        bytes32 requestId,
        address payable recipient,
        uint256 amount
    ) external nonReentrant {
        if (requestId == bytes32(0)) revert InvalidRequestId();
        if (requestUsed[agentId][requestId]) revert DuplicateRequest(requestId);
        if (!registry.isAuthorizedSigner(agentId, msg.sender)) revert UnauthorizedSigner();
        if (recipient == address(0)) revert InvalidRecipient();
        if (!approvedRecipients[agentId][recipient]) {
            revert RecipientNotApproved(recipient);
        }
        if (amount == 0) revert InvalidAmount();

        Policy storage policy = policies[agentId];
        if (policy.paused) revert AgentPaused(agentId);
        if (amount > policy.perPaymentLimit) {
            revert PerPaymentLimitExceeded(policy.perPaymentLimit, amount);
        }

        uint256 dayIndex = _rollDailyWindow(policy);
        uint256 attempted = policy.spentToday + amount;
        if (attempted > policy.dailyLimit) {
            // The owner may lower the daily limit below what was already spent today,
            // so compute the remaining allowance without underflowing.
            uint256 remaining =
                policy.dailyLimit > policy.spentToday ? policy.dailyLimit - policy.spentToday : 0;
            revert DailyLimitExceeded(agentId, attempted, remaining);
        }
        if (vaultBalance[agentId] < amount) {
            revert InsufficientVaultBalance(vaultBalance[agentId], amount);
        }

        requestUsed[agentId][requestId] = true;
        policy.spentToday = attempted;
        vaultBalance[agentId] -= amount;

        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert PaymentTransferFailed();

        emit PaymentExecuted(
            agentId,
            requestId,
            msg.sender,
            recipient,
            amount,
            dayIndex,
            policy.version
        );
    }

    function getPolicy(uint256 agentId)
        external
        view
        returns (
            uint256 perPaymentLimit,
            uint256 dailyLimit,
            uint256 spentToday,
            uint256 dayIndex,
            uint256 policyVersion,
            bool paused
        )
    {
        Policy memory policy = policies[agentId];
        uint256 currentDay = _currentDay();
        spentToday = policy.dayIndex == currentDay ? policy.spentToday : 0;
        return (
            policy.perPaymentLimit,
            policy.dailyLimit,
            spentToday,
            currentDay,
            policy.version,
            policy.paused
        );
    }

    receive() external payable {
        revert DirectTransferNotSupported();
    }

    fallback() external payable {
        revert DirectTransferNotSupported();
    }

    function _requireAgentOwner(uint256 agentId) internal view {
        if (registry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
    }

    function _currentDay() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function _rollDailyWindow(Policy storage policy) internal returns (uint256 dayIndex) {
        dayIndex = _currentDay();
        if (policy.dayIndex != dayIndex) {
            policy.dayIndex = dayIndex;
            policy.spentToday = 0;
        }
    }

    function _bumpPolicyVersion(Policy storage policy) internal returns (uint256 version) {
        version = policy.version + 1;
        policy.version = version;
    }
}
