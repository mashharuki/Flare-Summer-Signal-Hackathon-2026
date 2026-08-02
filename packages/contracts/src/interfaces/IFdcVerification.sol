// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IXRPPayment} from "./IXRPPayment.sol";

interface IFdcVerification {
    function verifyXRPPayment(IXRPPayment.Proof calldata proof) external view returns (bool);
}
