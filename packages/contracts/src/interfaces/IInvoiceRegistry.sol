// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IInvoiceRegistry {
    function settleFromCore(
        bytes32 invoiceId,
        bytes32 proofId,
        bytes32 payerAddressHash,
        uint256 amountDrops,
        uint64 paidAt,
        bytes32 memoHash
    ) external;
}
