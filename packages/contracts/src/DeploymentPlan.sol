// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CreditVault} from "./CreditVault.sol";
import {MockUSD} from "./MockUSD.sol";
import {ReserveFlowCore} from "./ReserveFlowCore.sol";
import {RiskEngine} from "./RiskEngine.sol";
import {InvoiceRegistry} from "./InvoiceRegistry.sol";
import {XrpProofRegistry} from "./XrpProofRegistry.sol";
import {IRiskEngine} from "./interfaces/IRiskEngine.sol";
import {IReserveLedger} from "./interfaces/IReserveLedger.sol";

/// @notice The deterministic Coston2 deployment and initialization sequence for the demo stack.
library DeploymentPlan {
    struct Deployment {
        ReserveFlowCore core;
        RiskEngine riskEngine;
        CreditVault vault;
        MockUSD token;
        XrpProofRegistry proofRegistry;
        InvoiceRegistry invoiceRegistry;
    }

    error InvalidApprovedBorrower();

    function deploy(address riskAdmin, address approvedBorrower, RiskEngine.RiskConfig memory initialRiskConfig)
        internal
        returns (Deployment memory deployment)
    {
        if (approvedBorrower == address(0)) {
            revert InvalidApprovedBorrower();
        }

        deployment.core = new ReserveFlowCore(riskAdmin);
        deployment.proofRegistry = new XrpProofRegistry(riskAdmin);
        deployment.proofRegistry.setProofConsumer(address(deployment.core), true);
        deployment.core.setProofRegistry(deployment.proofRegistry);
        deployment.invoiceRegistry = new InvoiceRegistry(riskAdmin, address(deployment.core));
        deployment.core.setInvoiceRegistry(deployment.invoiceRegistry);
        deployment.riskEngine = new RiskEngine(riskAdmin, IReserveLedger(address(deployment.core)));
        deployment.vault = new CreditVault(
            riskAdmin, IReserveLedger(address(deployment.core)), IRiskEngine(address(deployment.riskEngine))
        );
        deployment.token = new MockUSD(address(deployment.vault));

        deployment.vault.setToken(deployment.token);
        deployment.core.setBorrowerApproval(approvedBorrower, true);
        deployment.riskEngine.setRiskConfig(initialRiskConfig);
    }
}
