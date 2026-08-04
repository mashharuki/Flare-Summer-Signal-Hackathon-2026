// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IInvoiceRegistry} from "./interfaces/IInvoiceRegistry.sol";

/// @notice Records invoice terms that can only be settled by a verified ReserveFlowCore payment.
contract InvoiceRegistry is IInvoiceRegistry {
    enum InvoiceStatus { OPEN, SETTLED, CANCELLED, EXPIRED }

    struct Invoice {
        address borrower;
        bytes32 reserveAccountId;
        bytes32 payerAddressHash;
        bytes32 memoHash;
        bytes32 settledProofId;
        uint256 minimumAmountDrops;
        uint256 settledAmountDrops;
        uint64 dueAt;
        uint64 settledAt;
        InvoiceStatus status;
    }

    error ZeroAddress();
    error ZeroValue();
    error InvalidDueAt(uint64 dueAt);
    error InvoiceNotFound(bytes32 invoiceId);
    error InvoiceNotOpen(bytes32 invoiceId);
    error OnlyCore();
    error OnlyBorrower();
    error PayerMismatch(bytes32 expected, bytes32 actual);
    error PaymentAmountTooLow(uint256 minimum, uint256 actual);
    error MemoMismatch(bytes32 expected, bytes32 actual);
    error InvoicePastDue(uint64 dueAt, uint64 paidAt);

    event InvoiceCreated(
        bytes32 indexed invoiceId, address indexed borrower, bytes32 indexed reserveAccountId, uint256 minimumAmountDrops, uint64 dueAt
    );
    event InvoiceSettled(bytes32 indexed invoiceId, bytes32 indexed proofId, uint256 amountDrops, uint64 settledAt);
    event InvoiceCancelled(bytes32 indexed invoiceId);
    event InvoiceExpired(bytes32 indexed invoiceId);

    address public immutable core;
    mapping(address borrower => uint256 nonce) public nextNonce;
    mapping(bytes32 invoiceId => Invoice invoice) private invoices;
    mapping(bytes32 invoiceId => bool exists) private invoiceExists;

    constructor(address admin, address core_) {
        if (admin == address(0) || core_ == address(0)) revert ZeroAddress();
        core = core_;
    }

    function createInvoice(
        bytes32 reserveAccountId,
        bytes32 payerAddressHash,
        uint256 minimumAmountDrops,
        uint64 dueAt,
        bytes32 memoHash
    ) external returns (bytes32 invoiceId) {
        if (reserveAccountId == bytes32(0) || payerAddressHash == bytes32(0) || memoHash == bytes32(0)) revert ZeroValue();
        if (minimumAmountDrops == 0) revert ZeroValue();
        if (dueAt <= block.timestamp) revert InvalidDueAt(dueAt);

        uint256 nonce = nextNonce[msg.sender]++;
        invoiceId = keccak256(abi.encode(msg.sender, reserveAccountId, payerAddressHash, memoHash, nonce));
        invoiceExists[invoiceId] = true;
        invoices[invoiceId] = Invoice({
            borrower: msg.sender,
            reserveAccountId: reserveAccountId,
            payerAddressHash: payerAddressHash,
            memoHash: memoHash,
            settledProofId: bytes32(0),
            minimumAmountDrops: minimumAmountDrops,
            settledAmountDrops: 0,
            dueAt: dueAt,
            settledAt: 0,
            status: InvoiceStatus.OPEN
        });
        emit InvoiceCreated(invoiceId, msg.sender, reserveAccountId, minimumAmountDrops, dueAt);
    }

    function settleFromCore(
        bytes32 invoiceId,
        bytes32 proofId,
        bytes32 payerAddressHash,
        uint256 amountDrops,
        uint64 paidAt,
        bytes32 memoHash
    ) external override {
        if (msg.sender != core) revert OnlyCore();
        Invoice storage invoice = _invoice(invoiceId);
        if (invoice.status != InvoiceStatus.OPEN) revert InvoiceNotOpen(invoiceId);
        if (paidAt > invoice.dueAt) revert InvoicePastDue(invoice.dueAt, paidAt);
        if (payerAddressHash != invoice.payerAddressHash) revert PayerMismatch(invoice.payerAddressHash, payerAddressHash);
        if (amountDrops < invoice.minimumAmountDrops) revert PaymentAmountTooLow(invoice.minimumAmountDrops, amountDrops);
        if (memoHash != invoice.memoHash) revert MemoMismatch(invoice.memoHash, memoHash);

        invoice.status = InvoiceStatus.SETTLED;
        invoice.settledProofId = proofId;
        invoice.settledAmountDrops = amountDrops;
        invoice.settledAt = paidAt;
        emit InvoiceSettled(invoiceId, proofId, amountDrops, paidAt);
    }

    function cancelInvoice(bytes32 invoiceId) external {
        Invoice storage invoice = _invoice(invoiceId);
        if (msg.sender != invoice.borrower) revert OnlyBorrower();
        if (invoice.status != InvoiceStatus.OPEN) revert InvoiceNotOpen(invoiceId);
        invoice.status = InvoiceStatus.CANCELLED;
        emit InvoiceCancelled(invoiceId);
    }

    function expireInvoice(bytes32 invoiceId) external {
        Invoice storage invoice = _invoice(invoiceId);
        if (invoice.status != InvoiceStatus.OPEN) revert InvoiceNotOpen(invoiceId);
        if (block.timestamp <= invoice.dueAt) revert InvalidDueAt(invoice.dueAt);
        invoice.status = InvoiceStatus.EXPIRED;
        emit InvoiceExpired(invoiceId);
    }

    function getInvoice(bytes32 invoiceId) external view returns (Invoice memory) {
        return _invoice(invoiceId);
    }

    function _invoice(bytes32 invoiceId) private view returns (Invoice storage invoice) {
        if (!invoiceExists[invoiceId]) revert InvoiceNotFound(invoiceId);
        return invoices[invoiceId];
    }
}
