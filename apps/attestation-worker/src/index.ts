import {
  loadWorkerRuntimeConfig,
  type WorkerRuntimeConfig,
} from "@reserveflow/shared/runtime-config";

export function getWorkerRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): WorkerRuntimeConfig {
  return loadWorkerRuntimeConfig(environment);
}
