// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IRiskEngine {
    enum RiskStatus {
        HEALTHY,
        WARNING,
        MARGIN_CALL,
        PRICE_STALE,
        RESERVE_STALE,
        FROZEN
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

    function getRiskSnapshot(bytes32 accountId, uint256 debtWad) external view returns (RiskSnapshot memory);
}
