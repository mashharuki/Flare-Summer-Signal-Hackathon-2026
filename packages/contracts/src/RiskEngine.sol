// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IFlareContractRegistry} from "./interfaces/IFlareContractRegistry.sol";
import {IReserveLedger} from "./interfaces/IReserveLedger.sol";
import {ITestFtsoV2} from "./interfaces/ITestFtsoV2.sol";

/// @notice Derives Coston2 XRP reserve risk from verified drops and the TestFtsoV2 XRP/USD feed.
/// @dev Resolves `FtsoV2` from the Coston2 Contract Registry; Coston2 returns the TestFtsoV2 interface.
contract RiskEngine {
    uint256 public constant COSTON2_CHAIN_ID = 114;
    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant DROPS_PER_XRP = 1_000_000;
    address public constant FLARE_CONTRACT_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
    bytes21 public constant XRP_USD_FEED_ID = 0x015852502f55534400000000000000000000000000;

    enum RiskStatus {
        HEALTHY,
        WARNING,
        MARGIN_CALL,
        PRICE_STALE,
        RESERVE_STALE,
        FROZEN
    }

    struct RiskConfig {
        uint16 haircutBps;
        uint16 advanceRateBps;
        uint64 priceTtlSeconds;
        uint64 reserveTtlSeconds;
        uint16 warningHealthBps;
        uint16 marginCallHealthBps;
    }

    struct RiskSnapshot {
        uint256 grossReserveUsdWad;
        uint256 adjustedReserveUsdWad;
        uint256 creditLimitWad;
        uint256 availableCreditWad;
        uint256 healthFactorBps;
        bool healthIsInfinite;
        uint64 priceTimestamp;
        uint64 reserveTimestamp;
        RiskStatus status;
    }

    error UnsupportedChain(uint256 chainId);
    error ZeroAddress();
    error InvalidPriceDrop(uint256 dropBps);

    IReserveLedger public immutable reserveLedger;
    ITestFtsoV2 public immutable priceFeed;
    address public immutable riskAdmin;
    RiskConfig private config;

    constructor(address riskAdmin_, IReserveLedger reserveLedger_) {
        if (block.chainid != COSTON2_CHAIN_ID) {
            revert UnsupportedChain(block.chainid);
        }
        if (riskAdmin_ == address(0) || address(reserveLedger_) == address(0)) {
            revert ZeroAddress();
        }

        address priceFeedAddress = IFlareContractRegistry(FLARE_CONTRACT_REGISTRY).getContractAddressByName("FtsoV2");
        if (priceFeedAddress == address(0)) {
            revert ZeroAddress();
        }

        reserveLedger = reserveLedger_;
        priceFeed = ITestFtsoV2(priceFeedAddress);
        riskAdmin = riskAdmin_;
        config = RiskConfig({
            haircutBps: 3_000,
            advanceRateBps: 5_000,
            priceTtlSeconds: 60,
            reserveTtlSeconds: 900,
            warningHealthBps: 12_000,
            marginCallHealthBps: 10_000
        });
    }

    function getRiskConfig() external view returns (RiskConfig memory) {
        return config;
    }

    function getRiskSnapshot(bytes32 accountId, uint256 debtWad) external view returns (RiskSnapshot memory) {
        (uint256 priceWad, uint64 priceTimestamp) = priceFeed.getFeedByIdInWei(XRP_USD_FEED_ID);
        return _snapshot(accountId, debtWad, priceWad, priceTimestamp);
    }

    function simulatePriceDrop(bytes32 accountId, uint256 debtWad, uint256 dropBps)
        external
        view
        returns (RiskSnapshot memory)
    {
        if (dropBps > BASIS_POINTS) {
            revert InvalidPriceDrop(dropBps);
        }

        (uint256 priceWad, uint64 priceTimestamp) = priceFeed.getFeedByIdInWei(XRP_USD_FEED_ID);
        uint256 simulatedPriceWad = Math.mulDiv(priceWad, BASIS_POINTS - dropBps, BASIS_POINTS);
        return _snapshot(accountId, debtWad, simulatedPriceWad, priceTimestamp);
    }

    function _snapshot(bytes32 accountId, uint256 debtWad, uint256 priceWad, uint64 priceTimestamp)
        private
        view
        returns (RiskSnapshot memory snapshot)
    {
        IReserveLedger.ReserveAccount memory account = reserveLedger.getReserveAccount(accountId);

        snapshot.grossReserveUsdWad = Math.mulDiv(account.balanceDrops, priceWad, DROPS_PER_XRP);
        snapshot.adjustedReserveUsdWad =
            Math.mulDiv(snapshot.grossReserveUsdWad, BASIS_POINTS - config.haircutBps, BASIS_POINTS);
        snapshot.creditLimitWad = Math.mulDiv(snapshot.adjustedReserveUsdWad, config.advanceRateBps, BASIS_POINTS);
        snapshot.availableCreditWad = debtWad >= snapshot.creditLimitWad ? 0 : snapshot.creditLimitWad - debtWad;
        snapshot.priceTimestamp = priceTimestamp;
        snapshot.reserveTimestamp = account.lastAttestedAt;

        if (debtWad == 0) {
            snapshot.healthIsInfinite = true;
        } else {
            snapshot.healthFactorBps = Math.mulDiv(snapshot.creditLimitWad, BASIS_POINTS, debtWad);
        }

        snapshot.status =
            _status(account.status, priceTimestamp, account.lastAttestedAt, snapshot.healthFactorBps, debtWad);
    }

    function _status(
        IReserveLedger.AccountStatus accountStatus,
        uint64 priceTimestamp,
        uint64 reserveTimestamp,
        uint256 healthFactorBps,
        uint256 debtWad
    ) private view returns (RiskStatus) {
        if (accountStatus != IReserveLedger.AccountStatus.ACTIVE) {
            return RiskStatus.FROZEN;
        }
        if (!_isFresh(priceTimestamp, config.priceTtlSeconds)) {
            return RiskStatus.PRICE_STALE;
        }
        if (!_isFresh(reserveTimestamp, config.reserveTtlSeconds)) {
            return RiskStatus.RESERVE_STALE;
        }
        if (debtWad == 0 || healthFactorBps >= config.warningHealthBps) {
            return RiskStatus.HEALTHY;
        }
        if (healthFactorBps >= config.marginCallHealthBps) {
            return RiskStatus.WARNING;
        }
        return RiskStatus.MARGIN_CALL;
    }

    function _isFresh(uint64 timestamp, uint64 ttlSeconds) private view returns (bool) {
        return timestamp != 0 && timestamp <= block.timestamp && block.timestamp - timestamp <= ttlSeconds;
    }
}
