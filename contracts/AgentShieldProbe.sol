// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice A deliberately tiny contract used to prove the wallet -> chain -> receipt path.
/// @dev This is not the payment vault and must not hold real funds.
contract AgentShieldProbe {
    uint256 public marker;

    event MarkerUpdated(address indexed caller, uint256 value);

    function setMarker(uint256 newMarker) external {
        marker = newMarker;
        emit MarkerUpdated(msg.sender, newMarker);
    }
}
