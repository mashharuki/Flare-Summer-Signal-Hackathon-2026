// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IXrpProofRegistry {
    function consume(bytes32 proofId) external;
}
