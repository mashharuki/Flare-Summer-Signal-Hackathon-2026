// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal Flare Contract Registry interface used to resolve Coston2 protocol contracts.
interface IFlareContractRegistry {
    function getContractAddressByName(string calldata contractName) external view returns (address);
}
