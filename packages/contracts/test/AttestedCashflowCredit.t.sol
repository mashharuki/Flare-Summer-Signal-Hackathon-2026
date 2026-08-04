// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {InvoiceRegistry} from "../src/InvoiceRegistry.sol";
import {XrpProofRegistry} from "../src/XrpProofRegistry.sol";

interface VmAttestedCredit {
    function chainId(uint256 newChainId) external;
    function prank(address msgSender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
}

/// @notice TDD coverage for the new cross-feature proof and invoice boundary.
contract AttestedCashflowCreditTest {
    VmAttestedCredit internal constant vm = VmAttestedCredit(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant ADMIN = address(0xA11CE);
    address internal constant BORROWER = address(0xB0B);
    address internal constant CORE = address(0xC0DE);
    bytes32 internal constant ACCOUNT_ID = keccak256("reserve-account");
    bytes32 internal constant PAYER = keccak256("payer-xrpl-address");
    bytes32 internal constant MEMO_HASH = keccak256("ReserveFlow:invoice:001");

    XrpProofRegistry internal proofRegistry;
    InvoiceRegistry internal invoices;

    function setUp() public {
        vm.chainId(114);
        proofRegistry = new XrpProofRegistry(ADMIN);
        invoices = new InvoiceRegistry(ADMIN, CORE);
        vm.prank(ADMIN);
        proofRegistry.setProofConsumer(CORE, true);
    }

    function testProofCannotBeConsumedTwiceAcrossCreditFeatures() public {
        bytes32 proofId = keccak256("one-xrpl-payment");
        vm.prank(CORE);
        proofRegistry.consume(proofId);

        vm.prank(CORE);
        vm.expectRevert(abi.encodeWithSelector(XrpProofRegistry.ProofAlreadyConsumed.selector, proofId));
        proofRegistry.consume(proofId);
    }

    function testOnlyCoreCanSettleAnOpenInvoiceExactlyOnce() public {
        vm.prank(BORROWER);
        bytes32 invoiceId = invoices.createInvoice(ACCOUNT_ID, PAYER, 1_000_000, uint64(block.timestamp + 1 hours), MEMO_HASH);

        vm.prank(BORROWER);
        vm.expectRevert(InvoiceRegistry.OnlyCore.selector);
        invoices.settleFromCore(invoiceId, keccak256("proof"), PAYER, 1_000_000, uint64(block.timestamp), MEMO_HASH);

        vm.prank(CORE);
        invoices.settleFromCore(invoiceId, keccak256("proof"), PAYER, 1_000_000, uint64(block.timestamp), MEMO_HASH);

        InvoiceRegistry.Invoice memory invoice = invoices.getInvoice(invoiceId);
        assertEq(uint256(invoice.status), uint256(InvoiceRegistry.InvoiceStatus.SETTLED));
        assertEq(invoice.settledAmountDrops, 1_000_000);

        vm.prank(CORE);
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.InvoiceNotOpen.selector, invoiceId));
        invoices.settleFromCore(invoiceId, keccak256("different-proof"), PAYER, 1_000_000, uint64(block.timestamp), MEMO_HASH);
    }

    function testInvoiceRejectsWrongPayerMemoAmountAndLatePayments() public {
        vm.prank(BORROWER);
        bytes32 invoiceId = invoices.createInvoice(ACCOUNT_ID, PAYER, 1_000_000, uint64(block.timestamp + 1 hours), MEMO_HASH);

        vm.prank(CORE);
        vm.expectRevert();
        invoices.settleFromCore(invoiceId, keccak256("payer"), keccak256("wrong"), 1_000_000, uint64(block.timestamp), MEMO_HASH);

        vm.prank(CORE);
        vm.expectRevert();
        invoices.settleFromCore(invoiceId, keccak256("amount"), PAYER, 999_999, uint64(block.timestamp), MEMO_HASH);

        vm.prank(CORE);
        vm.expectRevert();
        invoices.settleFromCore(invoiceId, keccak256("memo"), PAYER, 1_000_000, uint64(block.timestamp), keccak256("wrong"));

        vm.prank(CORE);
        vm.expectRevert();
        invoices.settleFromCore(invoiceId, keccak256("late"), PAYER, 1_000_000, uint64(block.timestamp + 2 hours), MEMO_HASH);
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "assertion failed: uints differ");
    }
}
