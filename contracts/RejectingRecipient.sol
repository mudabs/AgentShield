// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test-only recipient that rejects native MON transfers.
contract RejectingRecipient {
    fallback() external payable {
        revert("recipient rejected payment");
    }
}
