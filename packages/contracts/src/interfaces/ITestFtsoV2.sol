// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Coston2 TestFtsoV2 view interface for 18-decimal feed values.
interface ITestFtsoV2 {
    function getFeedByIdInWei(bytes21 feedId) external view returns (uint256 value, uint64 timestamp);
}
