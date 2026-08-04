// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DeploymentPlan} from "../src/DeploymentPlan.sol";
import {IFdcVerification} from "../src/interfaces/IFdcVerification.sol";
import {IFlareContractRegistry} from "../src/interfaces/IFlareContractRegistry.sol";
import {ITestFtsoV2} from "../src/interfaces/ITestFtsoV2.sol";
import {IXRPPayment} from "../src/interfaces/IXRPPayment.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {RiskEngine} from "../src/RiskEngine.sol";
import {XrpRepaymentRouter} from "../src/XrpRepaymentRouter.sol";

interface VmDeployment {
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function prank(address msgSender) external;
}

contract MockFdcVerificationDeployment is IFdcVerification {
    function verifyXRPPayment(IXRPPayment.Proof calldata) external pure returns (bool) {
        return true;
    }
}

contract MockTestFtsoV2Deployment is ITestFtsoV2 {
    function getFeedByIdInWei(bytes21) external pure returns (uint256, uint64) {
        return (2e18, 1_700_000_000);
    }
}

contract MockContractRegistryDeployment is IFlareContractRegistry {
    IFdcVerification internal immutable verifier;
    ITestFtsoV2 internal immutable ftso;

    constructor(IFdcVerification verifier_, ITestFtsoV2 ftso_) {
        verifier = verifier_;
        ftso = ftso_;
    }

    function getContractAddressByName(string calldata contractName) external view returns (address) {
        bytes32 nameHash = keccak256(bytes(contractName));
        if (nameHash == keccak256("FdcVerification")) {
            return address(verifier);
        }
        if (nameHash == keccak256("FtsoV2")) {
            return address(ftso);
        }
        revert("unexpected contract");
    }
}

contract DeploymentPlanTest {
    VmDeployment internal constant vm = VmDeployment(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant FLARE_CONTRACT_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
    address internal constant APPROVED_BORROWER = address(0xB0B);

    function testDeploysTheCoston2DemoStackInItsRequiredOrder() public {
        vm.chainId(114);
        MockFdcVerificationDeployment verifier = new MockFdcVerificationDeployment();
        MockTestFtsoV2Deployment ftso = new MockTestFtsoV2Deployment();
        MockContractRegistryDeployment registry = new MockContractRegistryDeployment(verifier, ftso);
        vm.etch(FLARE_CONTRACT_REGISTRY, address(registry).code);

        RiskEngine.RiskConfig memory config = RiskEngine.RiskConfig({
            haircutBps: 3_000,
            advanceRateBps: 5_000,
            priceTtlSeconds: 60,
            reserveTtlSeconds: 900,
            warningHealthBps: 12_000,
            marginCallHealthBps: 10_000
        });
        vm.prank(address(this));
        DeploymentPlan.Deployment memory deployment = DeploymentPlan.deploy(address(this), APPROVED_BORROWER, config);

        assertEq(address(deployment.core.fdcVerification()), address(verifier));
        assertEq(address(deployment.core.proofRegistry()), address(deployment.proofRegistry));
        assertEq(address(deployment.core.invoiceRegistry()), address(deployment.invoiceRegistry));
        assertEq(address(deployment.riskEngine.reserveLedger()), address(deployment.core));
        assertEq(address(deployment.vault.reserveLedger()), address(deployment.core));
        assertEq(address(deployment.vault.riskEngine()), address(deployment.riskEngine));
        assertEq(address(deployment.vault.token()), address(deployment.token));
        assertEq(deployment.token.balanceOf(address(deployment.vault)), deployment.token.INITIAL_VAULT_LIQUIDITY());
        assertTrue(deployment.core.approvedBorrowers(APPROVED_BORROWER));
        assertEq(deployment.riskEngine.riskConfigVersion(), 2);
        assertFalse(deployment.token.hasRole(deployment.token.MINTER_ROLE(), address(this)));
    }

    function testConfiguresTheExactXrplCollectionAddressHashForNativeXrpRepayment() public {
        vm.chainId(114);
        MockFdcVerificationDeployment verifier = new MockFdcVerificationDeployment();
        MockTestFtsoV2Deployment ftso = new MockTestFtsoV2Deployment();
        MockContractRegistryDeployment registry = new MockContractRegistryDeployment(verifier, ftso);
        vm.etch(FLARE_CONTRACT_REGISTRY, address(registry).code);
        bytes32 collectionHash = keccak256(bytes("rELiPixQHM5NLgMqXovBmwZCYw6tFKZxh8"));

        DeploymentPlan.Deployment memory deployment = DeploymentPlan.deployWithXrpRepayment(
            address(this), APPROVED_BORROWER, _config(), collectionHash
        );

        assertTrue(address(deployment.repaymentRouter) != address(0));
        assertEq(deployment.repaymentRouter.collectionAddressHash(), collectionHash);
        assertEq(deployment.vault.repaymentRouter(), address(deployment.repaymentRouter));
    }

    function _config() private pure returns (RiskEngine.RiskConfig memory) {
        return RiskEngine.RiskConfig({
            haircutBps: 3_000,
            advanceRateBps: 5_000,
            priceTtlSeconds: 60,
            reserveTtlSeconds: 900,
            warningHealthBps: 12_000,
            marginCallHealthBps: 10_000
        });
    }

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "assertion failed: addresses differ");
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "assertion failed: uints differ");
    }

    function assertEq(bytes32 actual, bytes32 expected) internal pure {
        require(actual == expected, "assertion failed: bytes32 differ");
    }

    function assertTrue(bool condition) internal pure {
        require(condition, "assertion failed: condition is false");
    }

    function assertFalse(bool condition) internal pure {
        require(!condition, "assertion failed: condition is true");
    }
}
