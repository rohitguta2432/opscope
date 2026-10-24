// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixture token for OpScope demos. Local chains only.
/// OpenZeppelin 5 ERC20, so an over-balance transfer reverts with
/// ERC20InsufficientBalance(sender, balance, needed).
contract DemoToken is ERC20 {
    address public immutable minter;

    error OnlyMinter(address caller);

    constructor() ERC20("OpScope Demo Token", "DEMO") {
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert OnlyMinter(msg.sender);
        _mint(to, amount);
    }
}
