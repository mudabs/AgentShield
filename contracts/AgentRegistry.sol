// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Owner-controlled registry for the identity and lifecycle of an agent.
/// @dev The registry stores no funds. The vault uses it as the signer authority source.
contract AgentRegistry {
    error AgentNotFound(uint256 agentId);
    error InvalidSigner();
    error NotAgentOwner();

    struct Agent {
        address owner;
        address authorizedSigner;
        bool active;
        bytes32 metadataHash;
    }

    uint256 public nextAgentId = 1;
    mapping(uint256 agentId => Agent agent) private agents;

    event AgentCreated(
        uint256 indexed agentId,
        address indexed owner,
        address indexed authorizedSigner,
        bytes32 metadataHash
    );
    event AgentSignerUpdated(uint256 indexed agentId, address indexed authorizedSigner);
    event AgentStatusUpdated(uint256 indexed agentId, bool active);
    event AgentMetadataUpdated(uint256 indexed agentId, bytes32 metadataHash);

    function createAgent(address authorizedSigner, bytes32 metadataHash)
        external
        returns (uint256 agentId)
    {
        if (authorizedSigner == address(0)) revert InvalidSigner();

        agentId = nextAgentId++;
        agents[agentId] = Agent({
            owner: msg.sender,
            authorizedSigner: authorizedSigner,
            active: true,
            metadataHash: metadataHash
        });

        emit AgentCreated(agentId, msg.sender, authorizedSigner, metadataHash);
    }

    function setAuthorizedSigner(uint256 agentId, address authorizedSigner)
        external
        onlyAgentOwner(agentId)
    {
        if (authorizedSigner == address(0)) revert InvalidSigner();
        agents[agentId].authorizedSigner = authorizedSigner;
        emit AgentSignerUpdated(agentId, authorizedSigner);
    }

    function setActive(uint256 agentId, bool active) external onlyAgentOwner(agentId) {
        agents[agentId].active = active;
        emit AgentStatusUpdated(agentId, active);
    }

    function setMetadataHash(uint256 agentId, bytes32 metadataHash)
        external
        onlyAgentOwner(agentId)
    {
        agents[agentId].metadataHash = metadataHash;
        emit AgentMetadataUpdated(agentId, metadataHash);
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        _requireAgent(agentId);
        return agents[agentId];
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        _requireAgent(agentId);
        return agents[agentId].owner;
    }

    function authorizedSignerOf(uint256 agentId) external view returns (address) {
        _requireAgent(agentId);
        return agents[agentId].authorizedSigner;
    }

    function isActive(uint256 agentId) external view returns (bool) {
        return agents[agentId].owner != address(0) && agents[agentId].active;
    }

    function isAuthorizedSigner(uint256 agentId, address account) external view returns (bool) {
        Agent memory agent = agents[agentId];
        return agent.owner != address(0) && agent.active && agent.authorizedSigner == account;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        if (agents[agentId].owner == address(0)) revert AgentNotFound(agentId);
        if (agents[agentId].owner != msg.sender) revert NotAgentOwner();
        _;
    }

    function _requireAgent(uint256 agentId) private view {
        if (agents[agentId].owner == address(0)) revert AgentNotFound(agentId);
    }
}
