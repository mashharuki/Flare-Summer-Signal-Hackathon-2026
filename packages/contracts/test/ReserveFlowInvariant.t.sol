// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IFdcVerification} from "../src/interfaces/IFdcVerification.sol";
import {IFlareContractRegistry} from "../src/interfaces/IFlareContractRegistry.sol";
import {IXRPPayment} from "../src/interfaces/IXRPPayment.sol";
import {ReserveFlowCore} from "../src/ReserveFlowCore.sol";

interface VmInvariant {
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
}

struct FuzzSelector {
    address addr;
    bytes4[] selectors;
}

contract InvariantFdcVerification is IFdcVerification {
    function verifyXRPPayment(IXRPPayment.Proof calldata) external pure returns (bool) {
        return true;
    }
}

contract InvariantContractRegistry is IFlareContractRegistry {
    IFdcVerification internal immutable verifier;

    constructor(IFdcVerification verifier_) {
        verifier = verifier_;
    }

    function getContractAddressByName(string calldata contractName) external view returns (address) {
        require(keccak256(bytes(contractName)) == keccak256("FdcVerification"), "unexpected contract");
        return address(verifier);
    }
}

contract ReserveLedgerHandler {
    bytes32 internal constant TEST_XRP = bytes32("testXRP");
    bytes32 internal constant EXTERNAL_ADDRESS_HASH = keccak256("rInvariantReserveAddress");

    ReserveFlowCore internal immutable core;
    bytes32 public accountId;
    uint256 public expectedBalanceDrops;
    uint64 public expectedLedger;
    uint256 private nonce;

    constructor(ReserveFlowCore core_) {
        core = core_;
    }

    function initialize() external {
        require(accountId == bytes32(0), "already initialized");
        accountId = core.registerReserveAccount(EXTERNAL_ADDRESS_HASH);
    }

    function deposit(uint96 amountSeed) external {
        uint256 amountDrops = (uint256(amountSeed) % 1e18) + 1;
        _submit(true, amountDrops);
        expectedBalanceDrops += amountDrops;
    }

    function withdraw(uint96 amountSeed) external {
        if (expectedBalanceDrops == 0) {
            return;
        }

        uint256 amountDrops = (uint256(amountSeed) % expectedBalanceDrops) + 1;
        _submit(false, amountDrops);
        expectedBalanceDrops -= amountDrops;
    }

    function _submit(bool incoming, uint256 amountDrops) private {
        nonce++;
        expectedLedger++;
        bytes32 externalCounterparty = bytes32(uint256(9));
        core.submitXrpPaymentProof(
            accountId,
            IXRPPayment.Proof({
                merkleProof: new bytes32[](0),
                data: IXRPPayment.Response({
                    attestationType: bytes32(uint256(8)),
                    sourceId: TEST_XRP,
                    votingRound: 1,
                    lowestUsedTimestamp: 1,
                    requestBody: IXRPPayment.RequestBody({transactionId: bytes32(nonce), proofOwner: address(this)}),
                    responseBody: IXRPPayment.ResponseBody({
                        blockNumber: expectedLedger,
                        blockTimestamp: expectedLedger,
                        sourceAddress: "rInvariantReserveAddress",
                        sourceAddressHash: incoming ? externalCounterparty : EXTERNAL_ADDRESS_HASH,
                        receivingAddressHash: incoming ? EXTERNAL_ADDRESS_HASH : externalCounterparty,
                        intendedReceivingAddressHash: incoming ? EXTERNAL_ADDRESS_HASH : externalCounterparty,
                        spentAmount: incoming ? int256(0) : int256(amountDrops),
                        intendedSpentAmount: incoming ? int256(0) : int256(amountDrops),
                        receivedAmount: incoming ? int256(amountDrops) : int256(0),
                        intendedReceivedAmount: incoming ? int256(amountDrops) : int256(0),
                        hasMemoData: false,
                        firstMemoData: bytes(""),
                        hasDestinationTag: false,
                        destinationTag: 0,
                        status: 0
                    })
                })
            })
        );
    }
}

contract ReserveFlowInvariantTest {
    address internal constant FLARE_CONTRACT_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
    VmInvariant internal constant vm = VmInvariant(address(uint160(uint256(keccak256("hevm cheat code")))));

    ReserveFlowCore internal core;
    ReserveLedgerHandler internal handler;

    function setUp() public {
        vm.chainId(114);
        InvariantFdcVerification verifier = new InvariantFdcVerification();
        InvariantContractRegistry registry = new InvariantContractRegistry(verifier);
        vm.etch(FLARE_CONTRACT_REGISTRY, address(registry).code);

        core = new ReserveFlowCore(address(this));
        handler = new ReserveLedgerHandler(core);
        core.setBorrowerApproval(address(handler), true);
        handler.initialize();
        core.approveReserveAccount(handler.accountId());
    }

    function targetSelectors() public view returns (FuzzSelector[] memory targets) {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = ReserveLedgerHandler.deposit.selector;
        selectors[1] = ReserveLedgerHandler.withdraw.selector;
        targets = new FuzzSelector[](1);
        targets[0] = FuzzSelector({addr: address(handler), selectors: selectors});
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariant_ReserveBalanceAndLedgerMatchSuccessfulProofHistory() public view {
        ReserveFlowCore.ReserveAccount memory account = core.getReserveAccount(handler.accountId());
        assertEq(account.balanceDrops, handler.expectedBalanceDrops());
        assertEq(account.lastExternalLedger, handler.expectedLedger());
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "assertion failed: uints differ");
    }
}
