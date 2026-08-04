console.error(
  "request:xrp-payment-proof is retired. Start the non-custodial API with `pnpm --filter @reserveflow/attestation-worker serve:attestations`, then submit the FDC fee and ReserveFlowCore proof from the connected Web wallet.",
);
process.exitCode = 1;
