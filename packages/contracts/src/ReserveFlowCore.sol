// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IFdcVerification} from "./interfaces/IFdcVerification.sol";
import {IXRPPayment} from "./interfaces/IXRPPayment.sol";

/// @notice Coston2 reserve ledger updated only by FDC-verified XRPL Testnet payments.
contract ReserveFlowCore is AccessControl {
    uint256 public constant COSTON2_CHAIN_ID = 114;
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");
    bytes32 public constant TEST_XRP_SOURCE_ID = bytes32("testXRP");
    uint8 public constant XRPL_PAYMENT_SUCCESS = 0;

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

    error UnsupportedChain(uint256 chainId);
    error ZeroAddress();
    error BorrowerNotApproved(address borrower);
    error AccountAlreadyExists(bytes32 accountId);
    error AccountNotFound(bytes32 accountId);
    error AccountNotPendingApproval(bytes32 accountId);
    error AccountNotFrozen(bytes32 accountId);
    error AccountNotActive(bytes32 accountId, AccountStatus status);
    error InvalidFdcProof();
    error UnsupportedProofSource(bytes32 sourceId);
    error UnauthorizedProofSubmitter(address expectedBorrower, address actualSubmitter);
    error ProofOwnerMismatch(address expectedBorrower, address proofOwner);
    error InvalidPaymentStatus(uint8 status);
    error AccountAddressMismatch(bytes32 expectedAddressHash);
    error InvalidPaymentAmount();
    error InsufficientReserveBalance(uint256 balanceDrops, uint256 withdrawalDrops);
    error ProofAlreadyUsed(bytes32 proofId);
    error OutOfOrderLedger(uint64 lastLedger, uint64 submittedLedger);

    event BorrowerApprovalUpdated(address indexed borrower, bool approved);
    event ReserveAccountRegistered(
        bytes32 indexed accountId, address indexed borrower, bytes32 sourceId, bytes32 externalAddressHash
    );
    event ReserveAccountApproved(bytes32 indexed accountId);
    event ReserveAccountFrozen(bytes32 indexed accountId, bool frozen);
    event ReserveUpdated(
        bytes32 indexed accountId,
        bytes32 indexed proofId,
        bool incoming,
        uint256 amountDrops,
        uint256 balanceDrops,
        uint64 externalLedger,
        uint64 attestedAt
    );

    IFdcVerification public immutable fdcVerification;

    mapping(address borrower => bool approved) public approvedBorrowers;
    mapping(bytes32 accountId => ReserveAccount account) private reserveAccounts;
    mapping(bytes32 accountId => bool exists) private accountExists;
    mapping(bytes32 proofId => bool used) public usedProofs;

    constructor(address riskAdmin, IFdcVerification verifier) {
        if (block.chainid != COSTON2_CHAIN_ID) {
            revert UnsupportedChain(block.chainid);
        }
        if (riskAdmin == address(0) || address(verifier) == address(0)) {
            revert ZeroAddress();
        }

        fdcVerification = verifier;
        _grantRole(DEFAULT_ADMIN_ROLE, riskAdmin);
        _grantRole(RISK_ADMIN_ROLE, riskAdmin);
    }

    function setBorrowerApproval(address borrower, bool approved) external onlyRole(RISK_ADMIN_ROLE) {
        if (borrower == address(0)) {
            revert ZeroAddress();
        }

        approvedBorrowers[borrower] = approved;
        emit BorrowerApprovalUpdated(borrower, approved);
    }

    function registerReserveAccount(bytes32 externalAddressHash) external returns (bytes32 accountId) {
        if (!approvedBorrowers[msg.sender]) {
            revert BorrowerNotApproved(msg.sender);
        }
        if (externalAddressHash == bytes32(0)) {
            revert AccountAddressMismatch(bytes32(0));
        }

        accountId = computeAccountId(msg.sender, TEST_XRP_SOURCE_ID, externalAddressHash);
        if (accountExists[accountId]) {
            revert AccountAlreadyExists(accountId);
        }

        accountExists[accountId] = true;
        reserveAccounts[accountId] = ReserveAccount({
            borrower: msg.sender,
            sourceId: TEST_XRP_SOURCE_ID,
            externalAddressHash: externalAddressHash,
            balanceDrops: 0,
            lastExternalLedger: 0,
            lastAttestedAt: 0,
            status: AccountStatus.PENDING_APPROVAL
        });

        emit ReserveAccountRegistered(accountId, msg.sender, TEST_XRP_SOURCE_ID, externalAddressHash);
    }

    function approveReserveAccount(bytes32 accountId) external onlyRole(RISK_ADMIN_ROLE) {
        ReserveAccount storage account = _account(accountId);
        if (account.status != AccountStatus.PENDING_APPROVAL) {
            revert AccountNotPendingApproval(accountId);
        }

        account.status = AccountStatus.ACTIVE;
        emit ReserveAccountApproved(accountId);
    }

    function setReserveAccountFrozen(bytes32 accountId, bool frozen) external onlyRole(RISK_ADMIN_ROLE) {
        ReserveAccount storage account = _account(accountId);
        if (frozen) {
            if (account.status != AccountStatus.ACTIVE) {
                revert AccountNotActive(accountId, account.status);
            }
            account.status = AccountStatus.FROZEN;
        } else {
            if (account.status != AccountStatus.FROZEN) {
                revert AccountNotFrozen(accountId);
            }
            account.status = AccountStatus.ACTIVE;
        }

        emit ReserveAccountFrozen(accountId, frozen);
    }

    function getReserveAccount(bytes32 accountId) external view returns (ReserveAccount memory) {
        return _account(accountId);
    }

    function computeAccountId(address borrower, bytes32 sourceId, bytes32 externalAddressHash)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(borrower, sourceId, externalAddressHash));
    }

    function submitXrpPaymentProof(bytes32 accountId, IXRPPayment.Proof calldata proof) external {
        ReserveAccount storage account = _account(accountId);
        if (account.status != AccountStatus.ACTIVE) {
            revert AccountNotActive(accountId, account.status);
        }
        if (msg.sender != account.borrower) {
            revert UnauthorizedProofSubmitter(account.borrower, msg.sender);
        }
        if (!fdcVerification.verifyXRPPayment(proof)) {
            revert InvalidFdcProof();
        }

        IXRPPayment.Response calldata response = proof.data;
        if (response.sourceId != TEST_XRP_SOURCE_ID) {
            revert UnsupportedProofSource(response.sourceId);
        }
        if (response.requestBody.proofOwner != account.borrower) {
            revert ProofOwnerMismatch(account.borrower, response.requestBody.proofOwner);
        }
        if (response.responseBody.status != XRPL_PAYMENT_SUCCESS) {
            revert InvalidPaymentStatus(response.responseBody.status);
        }
        bytes32 proofId = keccak256(abi.encode(response.sourceId, response.requestBody.transactionId));
        if (usedProofs[proofId]) {
            revert ProofAlreadyUsed(proofId);
        }
        if (response.responseBody.blockNumber <= account.lastExternalLedger) {
            revert OutOfOrderLedger(account.lastExternalLedger, response.responseBody.blockNumber);
        }

        bool incoming = response.responseBody.receivingAddressHash == account.externalAddressHash;
        bool outgoing = response.responseBody.sourceAddressHash == account.externalAddressHash;
        if (incoming == outgoing) {
            revert AccountAddressMismatch(account.externalAddressHash);
        }

        uint256 amountDrops;
        if (incoming) {
            amountDrops = _positiveAmount(response.responseBody.receivedAmount);
            account.balanceDrops += amountDrops;
        } else {
            amountDrops = _positiveAmount(response.responseBody.spentAmount);
            if (amountDrops > account.balanceDrops) {
                revert InsufficientReserveBalance(account.balanceDrops, amountDrops);
            }
            account.balanceDrops -= amountDrops;
        }

        usedProofs[proofId] = true;
        account.lastExternalLedger = response.responseBody.blockNumber;
        account.lastAttestedAt = response.responseBody.blockTimestamp;

        emit ReserveUpdated(
            accountId,
            proofId,
            incoming,
            amountDrops,
            account.balanceDrops,
            account.lastExternalLedger,
            account.lastAttestedAt
        );
    }

    function _account(bytes32 accountId) private view returns (ReserveAccount storage account) {
        if (!accountExists[accountId]) {
            revert AccountNotFound(accountId);
        }
        return reserveAccounts[accountId];
    }

    function _positiveAmount(int256 value) private pure returns (uint256) {
        if (value <= 0) {
            revert InvalidPaymentAmount();
        }
        return uint256(value);
    }
}
