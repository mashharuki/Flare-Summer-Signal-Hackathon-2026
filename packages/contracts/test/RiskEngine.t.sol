// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IReserveLedger} from "../src/interfaces/IReserveLedger.sol";
import {IFlareContractRegistry} from "../src/interfaces/IFlareContractRegistry.sol";
import {ITestFtsoV2} from "../src/interfaces/ITestFtsoV2.sol";
import {RiskEngine} from "../src/RiskEngine.sol";

interface VmRisk {
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function warp(uint256 newTimestamp) external;
}

contract MockReserveLedgerRisk is IReserveLedger {
    ReserveAccount internal account;

    function setAccount(uint256 balanceDrops, uint64 lastAttestedAt, AccountStatus status) external {
        account = ReserveAccount({
            borrower: address(0xB0B),
            sourceId: bytes32("testXRP"),
            externalAddressHash: keccak256("rReserveFlowTestAddress"),
            balanceDrops: balanceDrops,
            lastExternalLedger: 100,
            lastAttestedAt: lastAttestedAt,
            status: status
        });
    }

    function getReserveAccount(bytes32) external view returns (ReserveAccount memory) {
        return account;
    }
}

contract MockTestFtsoV2 is ITestFtsoV2 {
    bytes21 internal constant XRP_USD_FEED_ID = 0x015852502f55534400000000000000000000000000;

    uint256 internal priceWad;
    uint64 internal priceTimestamp;

    function setPrice(uint256 nextPriceWad, uint64 nextTimestamp) external {
        priceWad = nextPriceWad;
        priceTimestamp = nextTimestamp;
    }

    function getFeedByIdInWei(bytes21 feedId) external view returns (uint256, uint64) {
        require(feedId == XRP_USD_FEED_ID, "unexpected feed");
        return (priceWad, priceTimestamp);
    }
}

contract MockContractRegistryRisk is IFlareContractRegistry {
    ITestFtsoV2 internal immutable testFtsoV2;

    constructor(ITestFtsoV2 testFtsoV2_) {
        testFtsoV2 = testFtsoV2_;
    }

    function getContractAddressByName(string calldata contractName) external view returns (address) {
        require(keccak256(bytes(contractName)) == keccak256("FtsoV2"), "unexpected contract");
        return address(testFtsoV2);
    }
}

contract RiskEngineTest {
    VmRisk internal constant vm = VmRisk(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 internal constant ACCOUNT_ID = keccak256("account");
    address internal constant FLARE_CONTRACT_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
    uint256 internal constant PRICE_WAD = 2e18;
    uint256 internal constant RESERVE_DROPS = 100_000_000;
    uint256 internal constant DEBT_WAD = 50e18;

    MockReserveLedgerRisk internal reserveLedger;
    MockTestFtsoV2 internal priceFeed;
    MockContractRegistryRisk internal contractRegistry;
    RiskEngine internal riskEngine;

    function setUp() public {
        vm.chainId(114);
        vm.warp(1_700_001_000);

        reserveLedger = new MockReserveLedgerRisk();
        reserveLedger.setAccount(RESERVE_DROPS, uint64(block.timestamp), IReserveLedger.AccountStatus.ACTIVE);
        priceFeed = new MockTestFtsoV2();
        priceFeed.setPrice(PRICE_WAD, uint64(block.timestamp));
        contractRegistry = new MockContractRegistryRisk(priceFeed);
        vm.etch(FLARE_CONTRACT_REGISTRY, address(contractRegistry).code);
        riskEngine = new RiskEngine(address(this), reserveLedger);
    }

    function testCalculatesConservativeXrpCreditValuesAndHealthyStatus() public view {
        RiskEngine.RiskSnapshot memory snapshot = riskEngine.getRiskSnapshot(ACCOUNT_ID, DEBT_WAD);

        assertEq(snapshot.grossReserveUsdWad, 200e18);
        assertEq(snapshot.adjustedReserveUsdWad, 140e18);
        assertEq(snapshot.creditLimitWad, 70e18);
        assertEq(snapshot.availableCreditWad, 20e18);
        assertEq(snapshot.healthFactorBps, 14_000);
        assertFalse(snapshot.healthIsInfinite);
        assertEq(uint256(snapshot.status), uint256(RiskEngine.RiskStatus.HEALTHY));
    }

    function testReturnsStaleStatusesWhenPriceOrReserveExceedsItsTtl() public {
        priceFeed.setPrice(PRICE_WAD, uint64(block.timestamp - 61));
        RiskEngine.RiskSnapshot memory priceStale = riskEngine.getRiskSnapshot(ACCOUNT_ID, DEBT_WAD);
        assertEq(uint256(priceStale.status), uint256(RiskEngine.RiskStatus.PRICE_STALE));

        priceFeed.setPrice(PRICE_WAD, uint64(block.timestamp));
        reserveLedger.setAccount(RESERVE_DROPS, uint64(block.timestamp - 901), IReserveLedger.AccountStatus.ACTIVE);
        RiskEngine.RiskSnapshot memory reserveStale = riskEngine.getRiskSnapshot(ACCOUNT_ID, DEBT_WAD);
        assertEq(uint256(reserveStale.status), uint256(RiskEngine.RiskStatus.RESERVE_STALE));
    }

    function testDerivesWarningMarginCallFrozenAndInfiniteHealthStates() public {
        RiskEngine.RiskSnapshot memory warning = riskEngine.getRiskSnapshot(ACCOUNT_ID, 60e18);
        assertEq(uint256(warning.status), uint256(RiskEngine.RiskStatus.WARNING));
        assertEq(warning.healthFactorBps, 11_666);

        RiskEngine.RiskSnapshot memory marginCall = riskEngine.getRiskSnapshot(ACCOUNT_ID, 71e18);
        assertEq(uint256(marginCall.status), uint256(RiskEngine.RiskStatus.MARGIN_CALL));

        reserveLedger.setAccount(RESERVE_DROPS, uint64(block.timestamp), IReserveLedger.AccountStatus.FROZEN);
        RiskEngine.RiskSnapshot memory frozen = riskEngine.getRiskSnapshot(ACCOUNT_ID, DEBT_WAD);
        assertEq(uint256(frozen.status), uint256(RiskEngine.RiskStatus.FROZEN));

        reserveLedger.setAccount(RESERVE_DROPS, uint64(block.timestamp), IReserveLedger.AccountStatus.ACTIVE);
        RiskEngine.RiskSnapshot memory debtFree = riskEngine.getRiskSnapshot(ACCOUNT_ID, 0);
        assertTrue(debtFree.healthIsInfinite);
        assertEq(uint256(debtFree.status), uint256(RiskEngine.RiskStatus.HEALTHY));
    }

    function testSimulatesPriceDropWithoutChangingTheCurrentSnapshot() public view {
        RiskEngine.RiskSnapshot memory simulated = riskEngine.simulatePriceDrop(ACCOUNT_ID, DEBT_WAD, 5_000);
        assertEq(simulated.creditLimitWad, 35e18);
        assertEq(simulated.healthFactorBps, 7_000);
        assertEq(uint256(simulated.status), uint256(RiskEngine.RiskStatus.MARGIN_CALL));

        RiskEngine.RiskSnapshot memory current = riskEngine.getRiskSnapshot(ACCOUNT_ID, DEBT_WAD);
        assertEq(current.creditLimitWad, 70e18);
        assertEq(uint256(current.status), uint256(RiskEngine.RiskStatus.HEALTHY));
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "assertion failed: uints differ");
    }

    function assertTrue(bool condition) internal pure {
        require(condition, "assertion failed: condition is false");
    }

    function assertFalse(bool condition) internal pure {
        require(!condition, "assertion failed: condition is true");
    }
}
