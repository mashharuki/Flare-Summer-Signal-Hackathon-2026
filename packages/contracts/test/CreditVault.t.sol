// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSD} from "../src/MockUSD.sol";
import {CreditVault} from "../src/CreditVault.sol";
import {IReserveLedger} from "../src/interfaces/IReserveLedger.sol";
import {IRiskEngine} from "../src/interfaces/IRiskEngine.sol";

interface VmCredit {
    function chainId(uint256 newChainId) external;
    function prank(address msgSender) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockReserveLedgerCredit is IReserveLedger {
    mapping(bytes32 accountId => ReserveAccount account) private accounts;

    function setAccount(bytes32 accountId, address borrower) external {
        accounts[accountId] = ReserveAccount({
            borrower: borrower,
            sourceId: bytes32("testXRP"),
            externalAddressHash: keccak256("rReserveFlowTestAddress"),
            balanceDrops: 100_000_000,
            lastExternalLedger: 100,
            lastAttestedAt: uint64(block.timestamp),
            status: AccountStatus.ACTIVE
        });
    }

    function getReserveAccount(bytes32 accountId) external view returns (ReserveAccount memory) {
        return accounts[accountId];
    }
}

contract MockRiskEngineCredit is IRiskEngine {
    RiskSnapshot private snapshot;

    function setSnapshot(uint256 creditLimitWad, uint256 availableCreditWad, RiskStatus status) external {
        snapshot = RiskSnapshot({
            grossReserveUsdWad: 200e18,
            adjustedReserveUsdWad: 140e18,
            creditLimitWad: creditLimitWad,
            availableCreditWad: availableCreditWad,
            healthFactorBps: 14_000,
            healthIsInfinite: false,
            priceTimestamp: uint64(block.timestamp),
            reserveTimestamp: uint64(block.timestamp),
            status: status
        });
    }

    function getRiskSnapshot(bytes32, uint256) external view returns (RiskSnapshot memory) {
        return snapshot;
    }
}

contract CreditVaultTest {
    VmCredit internal constant vm = VmCredit(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant RISK_ADMIN = address(0xA11CE);
    address internal constant BORROWER = address(0xB0B);
    address internal constant OTHER = address(0xC0FFEE);
    bytes32 internal constant ACCOUNT_ID = keccak256("account");

    MockReserveLedgerCredit internal reserveLedger;
    MockRiskEngineCredit internal riskEngine;
    CreditVault internal vault;
    MockUSD internal token;

    function setUp() public {
        vm.chainId(114);
        reserveLedger = new MockReserveLedgerCredit();
        reserveLedger.setAccount(ACCOUNT_ID, BORROWER);
        riskEngine = new MockRiskEngineCredit();
        riskEngine.setSnapshot(70e18, 70e18, IRiskEngine.RiskStatus.HEALTHY);
        vault = new CreditVault(RISK_ADMIN, reserveLedger, riskEngine);
        token = new MockUSD(address(vault));
        vm.prank(RISK_ADMIN);
        vault.setToken(token);
    }

    function testBorrowsOnlyWithinAHealthyUnpausedCreditLine() public {
        vm.prank(BORROWER);
        vault.openCreditLine(ACCOUNT_ID);

        vm.prank(BORROWER);
        vault.borrow(20e18);

        CreditVault.CreditPosition memory position = vault.getPosition(BORROWER);
        assertEq(position.principalWad, 20e18);
        assertEq(token.balanceOf(BORROWER), 20e18);
    }

    function testRejectsBorrowWithoutChangingDebtOrTokensWhenLimitOrRiskGateFails() public {
        vm.prank(BORROWER);
        vault.openCreditLine(ACCOUNT_ID);

        vm.prank(BORROWER);
        vm.expectRevert(abi.encodeWithSelector(CreditVault.CreditLimitExceeded.selector, 70e18, 71e18));
        vault.borrow(71e18);

        riskEngine.setSnapshot(70e18, 70e18, IRiskEngine.RiskStatus.PRICE_STALE);
        vm.prank(BORROWER);
        vm.expectRevert(CreditVault.StalePrice.selector);
        vault.borrow(1e18);

        assertEq(vault.getPosition(BORROWER).principalWad, 0);
        assertEq(token.balanceOf(BORROWER), 0);
    }

    function testRepaysInEveryRiskStateOnlyAfterAllowanceAndBalanceChecks() public {
        vm.prank(BORROWER);
        vault.openCreditLine(ACCOUNT_ID);
        vm.prank(BORROWER);
        vault.borrow(20e18);

        vm.prank(BORROWER);
        vm.expectRevert(abi.encodeWithSelector(CreditVault.InsufficientRfUsdAllowance.selector, 0, 10e18));
        vault.repay(10e18);

        vm.prank(BORROWER);
        token.approve(address(vault), 10e18);
        riskEngine.setSnapshot(70e18, 50e18, IRiskEngine.RiskStatus.MARGIN_CALL);
        vm.prank(RISK_ADMIN);
        vault.setBorrowingPaused(true);

        vm.prank(BORROWER);
        vault.repay(10e18);

        assertEq(vault.getPosition(BORROWER).principalWad, 10e18);
        assertEq(token.balanceOf(BORROWER), 10e18);
        assertEq(token.balanceOf(address(vault)), token.INITIAL_VAULT_LIQUIDITY() - 10e18);
    }

    function testRejectsExcessRepaymentWithoutMovingTokensOrDebt() public {
        vm.prank(BORROWER);
        vault.openCreditLine(ACCOUNT_ID);
        vm.prank(BORROWER);
        vault.borrow(20e18);
        vm.prank(BORROWER);
        token.approve(address(vault), 21e18);

        vm.prank(BORROWER);
        vm.expectRevert(abi.encodeWithSelector(CreditVault.ExcessRepayment.selector, 20e18, 21e18));
        vault.repay(21e18);

        assertEq(vault.getPosition(BORROWER).principalWad, 20e18);
        assertEq(token.balanceOf(BORROWER), 20e18);
    }

    function testOnlyRiskAdminCanPauseBorrowingOrConfigureTheToken() public {
        vm.prank(OTHER);
        vm.expectRevert();
        vault.setBorrowingPaused(true);

        vm.prank(OTHER);
        vm.expectRevert();
        vault.setToken(token);

        vm.prank(RISK_ADMIN);
        vault.setBorrowingPaused(true);
        assertTrue(vault.borrowingPaused());
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "assertion failed: uints differ");
    }

    function assertTrue(bool condition) internal pure {
        require(condition, "assertion failed: condition is false");
    }
}
