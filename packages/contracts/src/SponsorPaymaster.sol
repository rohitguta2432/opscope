// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

/// @notice Fixture gas sponsor for OpScope demos. Local chains only.
/// Sponsors any sender on its allowlist; pays from its EntryPoint deposit.
contract SponsorPaymaster is BasePaymaster {
    mapping(address => bool) public sponsored;

    error NotSponsored(address sender);

    event SponsorshipSet(address indexed account, bool enabled);

    constructor(IEntryPoint entryPoint_) BasePaymaster(entryPoint_) {}

    function setSponsored(address account, bool enabled) external onlyOwner {
        sponsored[account] = enabled;
        emit SponsorshipSet(account, enabled);
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        if (!sponsored[userOp.sender]) revert NotSponsored(userOp.sender);
        return ("", 0);
    }
}
