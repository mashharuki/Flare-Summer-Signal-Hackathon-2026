import { asAddress } from "@reserveflow/shared";

import {
  asApiCoordinator,
  createAttestationApi,
} from "../src/api/attestation-api.js";
import { startAttestationHttpServer } from "../src/api/http-server.js";
import { createSignatureAuthorizer } from "../src/api/signature-authorizer.js";
import { createCoston2AttestationRuntime } from "../src/fdc/coston2-attestation-runtime.js";
import { XrpPaymentAttestationCoordinator } from "../src/fdc/xrp-payment-attestation-coordinator.js";
import { getWorkerRuntimeConfig } from "../src/index.js";

function requiredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requiredAddress(name: string) {
  return asAddress(requiredValue(name));
}

function port(): number {
  const value = process.env.ATTESTATION_WORKER_PORT?.trim() ?? "8787";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65_535) {
    throw new Error("ATTESTATION_WORKER_PORT must be a valid TCP port.");
  }
  return Number(value);
}

async function main(): Promise<void> {
  const config = getWorkerRuntimeConfig(process.env);
  const runtime = await createCoston2AttestationRuntime({
    coreAddress: requiredAddress("RESERVE_FLOW_CORE_ADDRESS"),
    daLayerUrl: config.coston2DaLayerUrl.toString(),
    databasePath: requiredValue("ATTESTATION_DATABASE_PATH"),
    rpcUrl: config.coston2RpcUrl.toString(),
    verifierApiKey: config.fdcVerifierApiKey,
    verifierUrl: config.fdcVerifierUrl.toString(),
  });
  const coordinator = new XrpPaymentAttestationCoordinator(
    runtime.dependencies,
  );
  const api = createAttestationApi({
    authorize: createSignatureAuthorizer({
      getReserveAccount: runtime.dependencies.accountReader.getReserveAccount,
    }),
    coordinator: asApiCoordinator(coordinator),
  });
  const allowedOrigin = process.env.ATTESTATION_ALLOWED_ORIGIN?.trim();
  const server = startAttestationHttpServer({
    ...(allowedOrigin ? { allowedOrigin } : {}),
    api,
    port: port(),
  });
  server.on("listening", () => {
    console.log(`ReserveFlow attestation API listening on port ${port()}.`);
  });
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Unable to start attestation API.",
  );
  process.exitCode = 1;
});
