import {
  loadWebRuntimeConfig,
  type WebRuntimeConfig,
} from "@reserveflow/shared/runtime-config";

export function getWebRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): WebRuntimeConfig {
  return loadWebRuntimeConfig(environment);
}
