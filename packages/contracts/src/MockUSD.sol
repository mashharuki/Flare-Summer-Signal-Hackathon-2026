// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Coston2-only, non-production rfUSD liquidity for the ReserveFlow MVP.
/// @dev The initial minter and its admin role are both revoked in the constructor.
contract MockUSD is ERC20, AccessControl {
    uint256 public constant COSTON2_CHAIN_ID = 114;
    uint256 public constant INITIAL_VAULT_LIQUIDITY = 1_000_000e18;
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    error InvalidInitialVault();
    error UnsupportedChain(uint256 chainId);

    constructor(address initialVault) ERC20("ReserveFlow Test USD", "rfUSD") {
        if (block.chainid != COSTON2_CHAIN_ID) {
            revert UnsupportedChain(block.chainid);
        }
        if (initialVault == address(0)) {
            revert InvalidInitialVault();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _mint(initialVault, INITIAL_VAULT_LIQUIDITY);

        _revokeRole(MINTER_ROLE, msg.sender);
        _revokeRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Permanently unreachable after deployment because no minter or role admin remains.
    function mint(address recipient, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(recipient, amount);
    }
}
