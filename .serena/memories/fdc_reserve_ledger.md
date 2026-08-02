# FDC Reserve Ledger

- `packages/contracts/src/ReserveFlowCore.sol` is a Coston2-only (`chainid == 114`) ledger for approved borrowers' `testXRP` reserve accounts.
- The constructor injects the immutable `IFdcVerification` boundary; deployment automation must resolve that trusted address from Flare Contract Registry rather than hardcode it.
- `submitXrpPaymentProof` verifies the FDC proof before business checks and state updates. It requires: source ID `bytes32("testXRP")`, caller and `proofOwner` equal to account borrower, XRPL status 0, monotonic external ledger, unique proof ID (`keccak256(sourceId, transactionId)`), and exactly one matching external account direction.
- Incoming `receivedAmount` adds drops; outgoing `spentAmount` subtracts drops only when balance permits. All error paths revert prior to state changes.
- Local FDC ABI-compatible interfaces live in `packages/contracts/src/interfaces/IXRPPayment.sol` and `IFdcVerification.sol`; tests mock only the verifier return value, never parse untrusted proof content.