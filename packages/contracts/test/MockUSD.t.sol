// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSD} from "../src/MockUSD.sol";

interface Vm {
    function chainId(uint256 newChainId) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address msgSender) external;
}

contract MockUSDTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant INITIAL_VAULT_LIQUIDITY = 1_000_000e18;

    address internal constant VAULT = address(0xBEEF);
    address internal constant BORROWER = address(0xA11CE);

    MockUSD internal token;

    function setUp() public {
        vm.chainId(114);
        token = new MockUSD(VAULT);
    }

    function testInitializesCoston2DemoLiquidityInTheVault() public view {
        assertEq(token.name(), "ReserveFlow Test USD");
        assertEq(token.symbol(), "rfUSD");
        assertEq(token.totalSupply(), INITIAL_VAULT_LIQUIDITY);
        assertEq(token.balanceOf(VAULT), INITIAL_VAULT_LIQUIDITY);
    }

    function testRevokesMintAndAdminAuthorityAfterInitialVaultSupply() public {
        bytes32 minterRole = token.MINTER_ROLE();

        assertFalse(token.hasRole(minterRole, address(this)));
        assertFalse(token.hasRole(token.DEFAULT_ADMIN_ROLE(), address(this)));

        vm.expectRevert();
        token.mint(BORROWER, 1e18);

        vm.expectRevert();
        token.grantRole(minterRole, address(this));
    }

    function testVaultTransferFailsAtomicallyWhenLiquidityIsInsufficient() public {
        vm.prank(VAULT);
        token.transfer(BORROWER, INITIAL_VAULT_LIQUIDITY);

        uint256 borrowerBalanceBefore = token.balanceOf(BORROWER);

        vm.prank(VAULT);
        vm.expectRevert();
        token.transfer(BORROWER, 1);

        assertEq(token.balanceOf(VAULT), 0);
        assertEq(token.balanceOf(BORROWER), borrowerBalanceBefore);
        assertEq(token.totalSupply(), INITIAL_VAULT_LIQUIDITY);
    }

    function testRejectsAnUnsetVault() public {
        vm.expectRevert(MockUSD.InvalidInitialVault.selector);
        new MockUSD(address(0));
    }

    function testRejectsDeploymentOutsideCoston2() public {
        vm.chainId(31_337);

        vm.expectRevert(abi.encodeWithSelector(MockUSD.UnsupportedChain.selector, 31_337));
        new MockUSD(VAULT);
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "assertion failed: values differ");
    }

    function assertEq(string memory actual, string memory expected) internal pure {
        require(keccak256(bytes(actual)) == keccak256(bytes(expected)), "assertion failed: strings differ");
    }

    function assertFalse(bool condition) internal pure {
        require(!condition, "assertion failed: condition is true");
    }
}
