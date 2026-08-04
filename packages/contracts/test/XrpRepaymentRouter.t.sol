// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CreditVault} from "../src/CreditVault.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {XrpProofRegistry} from "../src/XrpProofRegistry.sol";
import {XrpRepaymentRouter} from "../src/XrpRepaymentRouter.sol";
import {IFdcVerification} from "../src/interfaces/IFdcVerification.sol";
import {IReserveLedger} from "../src/interfaces/IReserveLedger.sol";
import {IRiskEngine} from "../src/interfaces/IRiskEngine.sol";
import {ITestFtsoV2} from "../src/interfaces/ITestFtsoV2.sol";
import {IXRPPayment} from "../src/interfaces/IXRPPayment.sol";

interface VmRepayment {
    function chainId(uint256 newChainId) external;
    function prank(address msgSender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert() external;
}

contract RepaymentReserveLedger is IReserveLedger {
    bytes32 internal constant ACCOUNT = keccak256("repayment-account");
    address internal constant BORROWER = address(0xB0B);

    function getReserveAccount(bytes32) external pure returns (ReserveAccount memory) {
        return ReserveAccount({
            borrower: BORROWER, sourceId: bytes32("testXRP"), externalAddressHash: bytes32(uint256(1)), balanceDrops: 0,
            lastExternalLedger: 0, lastAttestedAt: 1, status: AccountStatus.ACTIVE
        });
    }
}

contract RepaymentRiskEngine is IRiskEngine {
    function getRiskSnapshot(bytes32, uint256) external pure returns (RiskSnapshot memory) {
        return RiskSnapshot({
            grossReserveUsdWad: 0, adjustedReserveUsdWad: 0, creditLimitWad: 100e18, availableCreditWad: 100e18,
            healthFactorBps: 20_000, healthIsInfinite: false, priceTimestamp: 1, reserveTimestamp: 1, status: RiskStatus.HEALTHY
        });
    }
}

contract RepaymentFdc is IFdcVerification {
    function verifyXRPPayment(IXRPPayment.Proof calldata) external pure returns (bool) { return true; }
}

contract RepaymentFtso is ITestFtsoV2 {
    function getFeedByIdInWei(bytes21) external view returns (uint256, uint64) { return (2e18, uint64(block.timestamp)); }
}

contract XrpRepaymentRouterTest {
    VmRepayment internal constant vm = VmRepayment(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant ADMIN = address(0xA11CE);
    address internal constant BORROWER = address(0xB0B);
    bytes32 internal constant ACCOUNT_ID = keccak256("repayment-account");
    bytes32 internal constant COLLECTION = keccak256("reserveflow-collection");
    bytes32 internal constant MEMO = keccak256("ReserveFlow:repay:001");

    CreditVault internal vault;
    XrpProofRegistry internal proofRegistry;
    XrpRepaymentRouter internal router;

    function setUp() public {
        vm.chainId(114);
        vault = new CreditVault(ADMIN, new RepaymentReserveLedger(), new RepaymentRiskEngine());
        MockUSD token = new MockUSD(address(vault));
        vm.prank(ADMIN);
        vault.setToken(token);
        vm.prank(BORROWER);
        vault.openCreditLine(ACCOUNT_ID);
        vm.prank(BORROWER);
        vault.borrow(20e18);

        proofRegistry = new XrpProofRegistry(ADMIN);
        router = new XrpRepaymentRouter(
            vault, new RepaymentFdc(), new RepaymentFtso(), proofRegistry,
            0x015852502f55534400000000000000000000000000, COLLECTION, 120
        );
        vm.prank(ADMIN);
        proofRegistry.setProofConsumer(address(router), true);
        vm.prank(ADMIN);
        vault.setRepaymentRouter(address(router));
    }

    function testSettlesOnlyExactMemoBoundXrpRepaymentIntent() public {
        vm.prank(BORROWER);
        bytes32 intentId = router.createRepaymentIntent(ACCOUNT_ID, 2e18, MEMO, uint64(block.timestamp + 10 minutes));

        vm.prank(BORROWER);
        router.settleRepaymentWithProof(intentId, repaymentProof(bytes32(uint256(1)), 1_000_000, true, COLLECTION));

        assertEq(vault.getPosition(BORROWER).principalWad, 18e18);
        assertEq(uint256(router.getRepaymentIntent(intentId).status), uint256(XrpRepaymentRouter.RepaymentStatus.SETTLED));
    }

    function testRejectsWrongCollectionMemoAndAmountWithoutReducingDebt() public {
        vm.prank(BORROWER);
        bytes32 intentId = router.createRepaymentIntent(ACCOUNT_ID, 2e18, MEMO, uint64(block.timestamp + 10 minutes));

        vm.prank(BORROWER);
        vm.expectRevert();
        router.settleRepaymentWithProof(intentId, repaymentProof(bytes32(uint256(2)), 1_000_000, false, COLLECTION));

        vm.prank(BORROWER);
        vm.expectRevert();
        router.settleRepaymentWithProof(intentId, repaymentProof(bytes32(uint256(3)), 999_999, true, COLLECTION));

        assertEq(vault.getPosition(BORROWER).principalWad, 20e18);
    }

    function repaymentProof(bytes32 transactionId, uint256 amount, bool correctMemo, bytes32 receiver)
        private
        view
        returns (IXRPPayment.Proof memory)
    {
        return IXRPPayment.Proof({
            merkleProof: new bytes32[](0),
            data: IXRPPayment.Response({
                attestationType: bytes32(uint256(8)), sourceId: bytes32("testXRP"), votingRound: 1, lowestUsedTimestamp: 1,
                requestBody: IXRPPayment.RequestBody({transactionId: transactionId, proofOwner: BORROWER}),
                responseBody: IXRPPayment.ResponseBody({
                    blockNumber: 1, blockTimestamp: uint64(block.timestamp), sourceAddress: "rPayer", sourceAddressHash: bytes32(uint256(9)),
                    receivingAddressHash: receiver, intendedReceivingAddressHash: receiver, spentAmount: int256(amount),
                    intendedSpentAmount: int256(amount), receivedAmount: int256(amount), intendedReceivedAmount: int256(amount),
                    hasMemoData: true,
                    firstMemoData: correctMemo ? bytes("ReserveFlow:repay:001") : bytes("wrong"),
                    hasDestinationTag: false, destinationTag: 0, status: 0
                })
            })
        });
    }

    function assertEq(uint256 actual, uint256 expected) internal pure { require(actual == expected, "assertion failed: uints differ"); }
}
