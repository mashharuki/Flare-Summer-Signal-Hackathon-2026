// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IXrpProofRegistry} from "./interfaces/IXrpProofRegistry.sol";

/// @notice Globally consumes an FDC-backed XRPL payment exactly once.
/// @dev Consumers must verify the FDC proof before calling `consume`.
contract XrpProofRegistry is AccessControl, IXrpProofRegistry {
    bytes32 public constant PROOF_CONSUMER_ROLE = keccak256("PROOF_CONSUMER_ROLE");

    error ZeroAddress();
    error ProofAlreadyConsumed(bytes32 proofId);

    event ProofConsumerUpdated(address indexed consumer, bool allowed);
    event ProofConsumed(bytes32 indexed proofId, address indexed consumer);

    mapping(bytes32 proofId => bool consumed) public consumedProofs;

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setProofConsumer(address consumer, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (consumer == address(0)) revert ZeroAddress();
        if (allowed) {
            _grantRole(PROOF_CONSUMER_ROLE, consumer);
        } else {
            _revokeRole(PROOF_CONSUMER_ROLE, consumer);
        }
        emit ProofConsumerUpdated(consumer, allowed);
    }

    function consume(bytes32 proofId) external override onlyRole(PROOF_CONSUMER_ROLE) {
        if (consumedProofs[proofId]) revert ProofAlreadyConsumed(proofId);
        consumedProofs[proofId] = true;
        emit ProofConsumed(proofId, msg.sender);
    }
}
