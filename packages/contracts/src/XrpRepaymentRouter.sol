// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {CreditVault} from "./CreditVault.sol";
import {IFdcVerification} from "./interfaces/IFdcVerification.sol";
import {ITestFtsoV2} from "./interfaces/ITestFtsoV2.sol";
import {IXRPPayment} from "./interfaces/IXRPPayment.sol";
import {IXrpProofRegistry} from "./interfaces/IXrpProofRegistry.sol";

/// @notice Converts a short-lived FTSO quote into an exact XRPL payment intent.
/// @dev It never controls an XRPL private key; the payer submits both FDC and settlement transactions.
contract XrpRepaymentRouter {
    uint256 public constant DROPS_PER_XRP = 1_000_000;
    bytes32 public constant TEST_XRP_SOURCE_ID = bytes32("testXRP");
    uint8 public constant XRPL_PAYMENT_SUCCESS = 0;

    enum RepaymentStatus { OPEN, SETTLED, CANCELLED, EXPIRED }

    struct RepaymentIntent {
        address borrower;
        bytes32 reserveAccountId;
        bytes32 memoHash;
        bytes32 settledProofId;
        uint256 repaymentWad;
        uint256 expectedAmountDrops;
        uint64 expiresAt;
        RepaymentStatus status;
    }

    error ZeroAddress();
    error ZeroValue();
    error IntentNotFound(bytes32 intentId);
    error IntentNotOpen(bytes32 intentId);
    error IntentExpired(uint64 expiresAt, uint64 paidAt);
    error InvalidFdcProof();
    error UnsupportedProofSource(bytes32 sourceId);
    error ProofOwnerMismatch(address expectedBorrower, address proofOwner);
    error InvalidPaymentStatus(uint8 status);
    error InvalidCollectionAddress(bytes32 expected, bytes32 actual);
    error MemoMismatch(bytes32 expected, bytes32 actual);
    error PaymentAmountMismatch(uint256 expected, uint256 actual);
    error CreditLineMismatch(bytes32 expected, bytes32 actual);
    error RepaymentExceedsPrincipal(uint256 principalWad, uint256 repaymentWad);
    error PriceStale(uint64 priceTimestamp);

    event RepaymentIntentCreated(
        bytes32 indexed intentId, address indexed borrower, bytes32 indexed accountId, uint256 repaymentWad, uint256 expectedAmountDrops, uint64 expiresAt
    );
    event RepaymentSettled(bytes32 indexed intentId, bytes32 indexed proofId, uint256 repaymentWad);
    event RepaymentIntentCancelled(bytes32 indexed intentId);
    event RepaymentIntentExpired(bytes32 indexed intentId);

    CreditVault public immutable vault;
    IFdcVerification public immutable fdcVerification;
    ITestFtsoV2 public immutable priceFeed;
    IXrpProofRegistry public immutable proofRegistry;
    bytes21 public immutable xrpUsdFeedId;
    bytes32 public immutable collectionAddressHash;
    uint64 public immutable priceTtlSeconds;
    mapping(address borrower => uint256 nonce) public nextNonce;
    mapping(bytes32 intentId => RepaymentIntent intent) private intents;
    mapping(bytes32 intentId => bool exists) private intentExists;

    constructor(
        CreditVault vault_,
        IFdcVerification fdcVerification_,
        ITestFtsoV2 priceFeed_,
        IXrpProofRegistry proofRegistry_,
        bytes21 xrpUsdFeedId_,
        bytes32 collectionAddressHash_,
        uint64 priceTtlSeconds_
    ) {
        if (
            address(vault_) == address(0) || address(fdcVerification_) == address(0) || address(priceFeed_) == address(0)
                || address(proofRegistry_) == address(0) || collectionAddressHash_ == bytes32(0)
        ) revert ZeroAddress();
        if (priceTtlSeconds_ == 0) revert ZeroValue();
        vault = vault_;
        fdcVerification = fdcVerification_;
        priceFeed = priceFeed_;
        proofRegistry = proofRegistry_;
        xrpUsdFeedId = xrpUsdFeedId_;
        collectionAddressHash = collectionAddressHash_;
        priceTtlSeconds = priceTtlSeconds_;
    }

    function createRepaymentIntent(bytes32 accountId, uint256 repaymentWad, bytes32 memoHash, uint64 expiresAt)
        external
        returns (bytes32 intentId)
    {
        if (repaymentWad == 0 || memoHash == bytes32(0)) revert ZeroValue();
        if (expiresAt <= block.timestamp) revert IntentExpired(expiresAt, uint64(block.timestamp));
        CreditVault.CreditPosition memory position = vault.getPosition(msg.sender);
        if (position.reserveAccountId != accountId) revert CreditLineMismatch(position.reserveAccountId, accountId);
        if (repaymentWad > position.principalWad) revert RepaymentExceedsPrincipal(position.principalWad, repaymentWad);
        (uint256 priceWad, uint64 priceTimestamp) = priceFeed.getFeedByIdInWei(xrpUsdFeedId);
        if (priceTimestamp > block.timestamp || block.timestamp - priceTimestamp > priceTtlSeconds) revert PriceStale(priceTimestamp);

        uint256 expectedAmountDrops = Math.mulDiv(repaymentWad, DROPS_PER_XRP, priceWad, Math.Rounding.Ceil);
        uint256 nonce = nextNonce[msg.sender]++;
        intentId = keccak256(abi.encode(msg.sender, accountId, memoHash, nonce));
        intentExists[intentId] = true;
        intents[intentId] = RepaymentIntent({
            borrower: msg.sender,
            reserveAccountId: accountId,
            memoHash: memoHash,
            settledProofId: bytes32(0),
            repaymentWad: repaymentWad,
            expectedAmountDrops: expectedAmountDrops,
            expiresAt: expiresAt,
            status: RepaymentStatus.OPEN
        });
        vault.reserveXrpRepayment(msg.sender, repaymentWad);
        emit RepaymentIntentCreated(intentId, msg.sender, accountId, repaymentWad, expectedAmountDrops, expiresAt);
    }

    function settleRepaymentWithProof(bytes32 intentId, IXRPPayment.Proof calldata proof) external {
        RepaymentIntent storage intent = _intent(intentId);
        if (intent.status != RepaymentStatus.OPEN) revert IntentNotOpen(intentId);
        if (msg.sender != intent.borrower) revert ProofOwnerMismatch(intent.borrower, msg.sender);
        if (!fdcVerification.verifyXRPPayment(proof)) revert InvalidFdcProof();
        IXRPPayment.Response calldata response = proof.data;
        if (response.sourceId != TEST_XRP_SOURCE_ID) revert UnsupportedProofSource(response.sourceId);
        if (response.requestBody.proofOwner != intent.borrower) revert ProofOwnerMismatch(intent.borrower, response.requestBody.proofOwner);
        if (response.responseBody.status != XRPL_PAYMENT_SUCCESS) revert InvalidPaymentStatus(response.responseBody.status);
        if (response.responseBody.blockTimestamp > intent.expiresAt) {
            revert IntentExpired(intent.expiresAt, response.responseBody.blockTimestamp);
        }
        if (response.responseBody.receivingAddressHash != collectionAddressHash) {
            revert InvalidCollectionAddress(collectionAddressHash, response.responseBody.receivingAddressHash);
        }
        if (keccak256(response.responseBody.firstMemoData) != intent.memoHash) {
            revert MemoMismatch(intent.memoHash, keccak256(response.responseBody.firstMemoData));
        }
        if (response.responseBody.receivedAmount <= 0) revert PaymentAmountMismatch(intent.expectedAmountDrops, 0);
        uint256 receivedAmount = uint256(response.responseBody.receivedAmount);
        if (receivedAmount != intent.expectedAmountDrops) {
            revert PaymentAmountMismatch(intent.expectedAmountDrops, receivedAmount);
        }
        bytes32 proofId = keccak256(abi.encode(response.sourceId, response.requestBody.transactionId));
        proofRegistry.consume(proofId);
        vault.settleXrpRepayment(intent.borrower, intent.repaymentWad);
        intent.status = RepaymentStatus.SETTLED;
        intent.settledProofId = proofId;
        emit RepaymentSettled(intentId, proofId, intent.repaymentWad);
    }

    function cancelRepaymentIntent(bytes32 intentId) external {
        RepaymentIntent storage intent = _intent(intentId);
        if (msg.sender != intent.borrower) revert ProofOwnerMismatch(intent.borrower, msg.sender);
        if (intent.status != RepaymentStatus.OPEN) revert IntentNotOpen(intentId);
        intent.status = RepaymentStatus.CANCELLED;
        vault.releaseXrpRepayment(intent.borrower, intent.repaymentWad);
        emit RepaymentIntentCancelled(intentId);
    }

    function expireRepaymentIntent(bytes32 intentId) external {
        RepaymentIntent storage intent = _intent(intentId);
        if (intent.status != RepaymentStatus.OPEN) revert IntentNotOpen(intentId);
        if (block.timestamp <= intent.expiresAt) revert IntentExpired(intent.expiresAt, uint64(block.timestamp));
        intent.status = RepaymentStatus.EXPIRED;
        vault.releaseXrpRepayment(intent.borrower, intent.repaymentWad);
        emit RepaymentIntentExpired(intentId);
    }

    function getRepaymentIntent(bytes32 intentId) external view returns (RepaymentIntent memory) {
        return _intent(intentId);
    }

    function _intent(bytes32 intentId) private view returns (RepaymentIntent storage intent) {
        if (!intentExists[intentId]) revert IntentNotFound(intentId);
        return intents[intentId];
    }
}
