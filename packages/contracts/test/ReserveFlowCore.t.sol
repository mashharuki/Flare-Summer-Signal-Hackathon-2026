// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IFdcVerification} from "../src/interfaces/IFdcVerification.sol";
import {IFlareContractRegistry} from "../src/interfaces/IFlareContractRegistry.sol";
import {IXRPPayment} from "../src/interfaces/IXRPPayment.sol";
import {ReserveFlowCore} from "../src/ReserveFlowCore.sol";
import {XrpProofRegistry} from "../src/XrpProofRegistry.sol";

interface VmReserve {
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address msgSender) external;
}

contract MockFdcVerification is IFdcVerification {
    bool internal verified = true;

    function setVerified(bool value) external {
        verified = value;
    }

    function verifyXRPPayment(IXRPPayment.Proof calldata) external view returns (bool) {
        return verified;
    }
}

contract MockContractRegistryReserve is IFlareContractRegistry {
    IFdcVerification internal immutable verifier;

    constructor(IFdcVerification verifier_) {
        verifier = verifier_;
    }

    function getContractAddressByName(string calldata contractName) external view returns (address) {
        require(keccak256(bytes(contractName)) == keccak256("FdcVerification"), "unexpected contract");
        return address(verifier);
    }
}

contract ReserveFlowCoreTest {
    VmReserve internal constant vm = VmReserve(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant BORROWER = address(0xB0B);
    address internal constant OTHER_BORROWER = address(0xCAFE);
    address internal constant FLARE_CONTRACT_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
    bytes32 internal constant EXTERNAL_ADDRESS_HASH = keccak256("rReserveFlowTestAddress");
    bytes32 internal constant TEST_XRP = bytes32("testXRP");

    MockFdcVerification internal verifier;
    MockContractRegistryReserve internal contractRegistry;
    ReserveFlowCore internal core;
    XrpProofRegistry internal proofRegistry;
    bytes32 internal accountId;

    function setUp() public {
        vm.chainId(114);
        verifier = new MockFdcVerification();
        contractRegistry = new MockContractRegistryReserve(verifier);
        vm.etch(FLARE_CONTRACT_REGISTRY, address(contractRegistry).code);
        core = new ReserveFlowCore(address(this));
        proofRegistry = new XrpProofRegistry(address(this));
        proofRegistry.setProofConsumer(address(core), true);
        core.setProofRegistry(proofRegistry);
        core.setBorrowerApproval(BORROWER, true);

        vm.prank(BORROWER);
        accountId = core.registerReserveAccount(EXTERNAL_ADDRESS_HASH);
        core.approveReserveAccount(accountId);
    }

    function testResolvesFdcVerificationFromTheCoston2ContractRegistry() public view {
        assertEq(address(core.fdcVerification()), address(verifier));
    }

    function testOnlyApprovedBorrowersCanRegisterTestXrpReserveAccounts() public {
        vm.prank(OTHER_BORROWER);
        vm.expectRevert(abi.encodeWithSelector(ReserveFlowCore.BorrowerNotApproved.selector, OTHER_BORROWER));
        core.registerReserveAccount(EXTERNAL_ADDRESS_HASH);

        ReserveFlowCore.ReserveAccount memory account = core.getReserveAccount(accountId);
        assertEq(account.borrower, BORROWER);
        assertEq(account.sourceId, TEST_XRP);
        assertEq(account.externalAddressHash, EXTERNAL_ADDRESS_HASH);
        assertEq(uint256(account.status), uint256(ReserveFlowCore.AccountStatus.ACTIVE));
    }

    function testInvalidFdcProofDoesNotChangeReserveState() public {
        verifier.setVerified(false);

        vm.prank(BORROWER);
        vm.expectRevert(ReserveFlowCore.InvalidFdcProof.selector);
        core.submitXrpPaymentProof(accountId, incomingProof(bytes32(uint256(1)), 100, 1_000_000));

        ReserveFlowCore.ReserveAccount memory account = core.getReserveAccount(accountId);
        assertEq(account.balanceDrops, 0);
        assertEq(account.lastExternalLedger, 0);
    }

    function testVerifiedIncomingAndOutgoingPaymentsUpdateTheReserveLedger() public {
        vm.prank(BORROWER);
        core.submitXrpPaymentProof(accountId, incomingProof(bytes32(uint256(1)), 100, 1_000_000));

        vm.prank(BORROWER);
        core.submitXrpPaymentProof(accountId, outgoingProof(bytes32(uint256(2)), 101, 400_000));

        ReserveFlowCore.ReserveAccount memory account = core.getReserveAccount(accountId);
        assertEq(account.balanceDrops, 600_000);
        assertEq(account.lastExternalLedger, 101);
        assertEq(account.lastAttestedAt, 1_700_000_101);
    }

    function testMismatchedOwnerTargetAndFailedPaymentCannotUpdateTheLedger() public {
        vm.prank(BORROWER);
        vm.expectRevert(abi.encodeWithSelector(ReserveFlowCore.ProofOwnerMismatch.selector, BORROWER, OTHER_BORROWER));
        core.submitXrpPaymentProof(
            accountId, incomingProofFor(OTHER_BORROWER, bytes32(uint256(3)), 102, EXTERNAL_ADDRESS_HASH, 1_000_000)
        );

        vm.prank(BORROWER);
        vm.expectRevert(abi.encodeWithSelector(ReserveFlowCore.AccountAddressMismatch.selector, EXTERNAL_ADDRESS_HASH));
        core.submitXrpPaymentProof(
            accountId, incomingProofFor(BORROWER, bytes32(uint256(4)), 102, keccak256("another address"), 1_000_000)
        );

        vm.prank(BORROWER);
        vm.expectRevert(abi.encodeWithSelector(ReserveFlowCore.InvalidPaymentStatus.selector, 1));
        core.submitXrpPaymentProof(accountId, failedProof(bytes32(uint256(5)), 102));

        assertEq(core.getReserveAccount(accountId).balanceDrops, 0);
    }

    function testReplayAndOutOfOrderLedgersDoNotChangeTheLedger() public {
        IXRPPayment.Proof memory firstProof = incomingProof(bytes32(uint256(6)), 103, 1_000_000);

        vm.prank(BORROWER);
        core.submitXrpPaymentProof(accountId, firstProof);

        vm.prank(BORROWER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ReserveFlowCore.ProofAlreadyUsed.selector, keccak256(abi.encode(TEST_XRP, bytes32(uint256(6))))
            )
        );
        core.submitXrpPaymentProof(accountId, firstProof);

        vm.prank(BORROWER);
        vm.expectRevert(abi.encodeWithSelector(ReserveFlowCore.OutOfOrderLedger.selector, 103, 103));
        core.submitXrpPaymentProof(accountId, incomingProof(bytes32(uint256(7)), 103, 1_000_000));

        ReserveFlowCore.ReserveAccount memory account = core.getReserveAccount(accountId);
        assertEq(account.balanceDrops, 1_000_000);
        assertEq(account.lastExternalLedger, 103);
    }

    function testReverseLedgersAndOverdrawsLeaveTheLedgerAndProofStateUnchanged() public {
        vm.prank(BORROWER);
        core.submitXrpPaymentProof(accountId, incomingProof(bytes32(uint256(10)), 200, 1_000_000));

        vm.prank(BORROWER);
        vm.expectRevert(abi.encodeWithSelector(ReserveFlowCore.OutOfOrderLedger.selector, 200, 199));
        core.submitXrpPaymentProof(accountId, incomingProof(bytes32(uint256(11)), 199, 1_000_000));

        bytes32 withdrawalTransactionId = bytes32(uint256(12));
        vm.prank(BORROWER);
        vm.expectRevert(abi.encodeWithSelector(ReserveFlowCore.InsufficientReserveBalance.selector, 1_000_000, 1_000_001));
        core.submitXrpPaymentProof(accountId, outgoingProof(withdrawalTransactionId, 201, 1_000_001));

        ReserveFlowCore.ReserveAccount memory account = core.getReserveAccount(accountId);
        assertEq(account.balanceDrops, 1_000_000);
        assertEq(account.lastExternalLedger, 200);
        assertFalse(core.usedProofs(keccak256(abi.encode(TEST_XRP, withdrawalTransactionId))));
    }

    function testOnlyRiskAdminCanFreezeAndUnfreezeAnAccount() public {
        vm.prank(OTHER_BORROWER);
        vm.expectRevert();
        core.setReserveAccountFrozen(accountId, true);

        core.setReserveAccountFrozen(accountId, true);
        assertEq(uint256(core.getReserveAccount(accountId).status), uint256(ReserveFlowCore.AccountStatus.FROZEN));

        vm.prank(BORROWER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ReserveFlowCore.AccountNotActive.selector, accountId, ReserveFlowCore.AccountStatus.FROZEN
            )
        );
        core.submitXrpPaymentProof(accountId, incomingProof(bytes32(uint256(8)), 104, 1_000_000));

        core.setReserveAccountFrozen(accountId, false);
        assertEq(uint256(core.getReserveAccount(accountId).status), uint256(ReserveFlowCore.AccountStatus.ACTIVE));
    }

    function incomingProof(bytes32 transactionId, uint64 ledgerIndex, uint256 amount)
        internal
        pure
        returns (IXRPPayment.Proof memory)
    {
        return incomingProofFor(BORROWER, transactionId, ledgerIndex, EXTERNAL_ADDRESS_HASH, amount);
    }

    function incomingProofFor(
        address proofOwner,
        bytes32 transactionId,
        uint64 ledgerIndex,
        bytes32 receivingAddressHash,
        uint256 amount
    ) internal pure returns (IXRPPayment.Proof memory) {
        return paymentProof(
            proofOwner, transactionId, ledgerIndex, bytes32(uint256(9)), receivingAddressHash, 0, amount, 0
        );
    }

    function outgoingProof(bytes32 transactionId, uint64 ledgerIndex, uint256 amount)
        internal
        pure
        returns (IXRPPayment.Proof memory)
    {
        return paymentProof(
            BORROWER, transactionId, ledgerIndex, EXTERNAL_ADDRESS_HASH, bytes32(uint256(9)), amount, 0, 0
        );
    }

    function failedProof(bytes32 transactionId, uint64 ledgerIndex) internal pure returns (IXRPPayment.Proof memory) {
        IXRPPayment.Proof memory proof = incomingProof(transactionId, ledgerIndex, 1_000_000);
        proof.data.responseBody.status = 1;
        return proof;
    }

    function paymentProof(
        address proofOwner,
        bytes32 transactionId,
        uint64 ledgerIndex,
        bytes32 sourceAddressHash,
        bytes32 receivingAddressHash,
        uint256 spentAmount,
        uint256 receivedAmount,
        uint8 status
    ) internal pure returns (IXRPPayment.Proof memory) {
        return IXRPPayment.Proof({
            merkleProof: new bytes32[](0),
            data: IXRPPayment.Response({
                attestationType: bytes32(uint256(8)),
                sourceId: TEST_XRP,
                votingRound: 1,
                lowestUsedTimestamp: 1_700_000_000,
                requestBody: IXRPPayment.RequestBody({transactionId: transactionId, proofOwner: proofOwner}),
                responseBody: IXRPPayment.ResponseBody({
                    blockNumber: ledgerIndex,
                    blockTimestamp: uint64(1_700_000_000 + ledgerIndex),
                    sourceAddress: "rReserveFlowTestAddress",
                    sourceAddressHash: sourceAddressHash,
                    receivingAddressHash: receivingAddressHash,
                    intendedReceivingAddressHash: receivingAddressHash,
                    spentAmount: int256(spentAmount),
                    intendedSpentAmount: int256(spentAmount),
                    receivedAmount: int256(receivedAmount),
                    intendedReceivedAmount: int256(receivedAmount),
                    hasMemoData: false,
                    firstMemoData: bytes(""),
                    hasDestinationTag: false,
                    destinationTag: 0,
                    status: status
                })
            })
        });
    }

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "assertion failed: addresses differ");
    }

    function assertEq(bytes32 actual, bytes32 expected) internal pure {
        require(actual == expected, "assertion failed: bytes32 differ");
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "assertion failed: uints differ");
    }

    function assertFalse(bool condition) internal pure {
        require(!condition, "assertion failed: condition is true");
    }
}
