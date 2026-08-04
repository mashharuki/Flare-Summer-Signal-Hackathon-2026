// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DeploymentPlan} from "../src/DeploymentPlan.sol";
import {RiskEngine} from "../src/RiskEngine.sol";

interface VmDeploy {
    function addr(uint256 privateKey) external returns (address keyAddr);
    function envAddress(string calldata name) external returns (address value);
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    function envUint(string calldata name) external returns (uint256 value);
    function serializeAddress(string calldata objectKey, string calldata valueKey, address value)
        external
        returns (string memory json);
    function serializeString(string calldata objectKey, string calldata valueKey, string calldata value)
        external
        returns (string memory json);
    function serializeUint(string calldata objectKey, string calldata valueKey, uint256 value)
        external
        returns (string memory json);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function writeJson(string calldata json, string calldata path) external;
}

/// @notice Broadcasts the Coston2-only demo deployment and writes public consumer configuration.
contract DeployCoston2 {
    VmDeploy private constant VM = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (DeploymentPlan.Deployment memory deployment) {
        uint256 deployerPrivateKey = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address riskAdmin = VM.addr(deployerPrivateKey);
        address approvedBorrower = VM.envAddress("DEMO_BORROWER_ADDRESS");
        string memory collectionAddress = VM.envOr("XRPL_TESTNET_COLLECTION_ADDRESS", "");
        require(bytes(collectionAddress).length > 0, "XRPL_TESTNET_COLLECTION_ADDRESS is required");
        string memory outputPath = VM.envOr("DEPLOYMENT_OUTPUT_PATH", "deployments/coston2.local.json");

        VM.startBroadcast(deployerPrivateKey);
        deployment = DeploymentPlan.deployWithXrpRepayment(
            riskAdmin, approvedBorrower, _initialRiskConfig(), keccak256(bytes(collectionAddress))
        );
        VM.stopBroadcast();

        _writePublicConfig(outputPath, riskAdmin, approvedBorrower, deployment);
    }

    function _initialRiskConfig() private pure returns (RiskEngine.RiskConfig memory) {
        return RiskEngine.RiskConfig({
            haircutBps: 3_000,
            advanceRateBps: 5_000,
            priceTtlSeconds: 60,
            reserveTtlSeconds: 900,
            warningHealthBps: 12_000,
            marginCallHealthBps: 10_000
        });
    }

    function _writePublicConfig(
        string memory outputPath,
        address riskAdmin,
        address approvedBorrower,
        DeploymentPlan.Deployment memory deployment
    ) private {
        string memory objectKey = "reserveflow-coston2";
        string memory json = VM.serializeUint(objectKey, "chainId", 114);
        json = VM.serializeString(objectKey, "network", "Coston2");
        json = VM.serializeString(objectKey, "sourceId", "testXRP");
        json = VM.serializeString(objectKey, "xrplPaymentFixtures", "packages/contracts/fixtures/xrpl-payments.demo.json");
        json = VM.serializeAddress(objectKey, "riskAdmin", riskAdmin);
        json = VM.serializeAddress(objectKey, "approvedBorrower", approvedBorrower);
        json = VM.serializeAddress(objectKey, "reserveFlowCore", address(deployment.core));
        json = VM.serializeAddress(objectKey, "riskEngine", address(deployment.riskEngine));
        json = VM.serializeAddress(objectKey, "creditVault", address(deployment.vault));
        json = VM.serializeAddress(objectKey, "rfUsd", address(deployment.token));
        json = VM.serializeAddress(objectKey, "xrpProofRegistry", address(deployment.proofRegistry));
        json = VM.serializeAddress(objectKey, "invoiceRegistry", address(deployment.invoiceRegistry));
        json = VM.serializeAddress(objectKey, "xrpRepaymentRouter", address(deployment.repaymentRouter));
        json = VM.serializeString(objectKey, "xrplTestnetCollectionAddress", VM.envOr("XRPL_TESTNET_COLLECTION_ADDRESS", ""));
        VM.writeJson(json, outputPath);
    }
}
