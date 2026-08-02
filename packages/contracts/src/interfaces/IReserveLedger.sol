// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IReserveLedger {
    enum AccountStatus {
        PENDING_APPROVAL,
        ACTIVE,
        STALE,
        FROZEN
    }

    struct ReserveAccount {
        address borrower;
        bytes32 sourceId;
        bytes32 externalAddressHash;
        uint256 balanceDrops;
        uint64 lastExternalLedger;
        uint64 lastAttestedAt;
        AccountStatus status;
    }

    function getReserveAccount(bytes32 accountId) external view returns (ReserveAccount memory);
}
