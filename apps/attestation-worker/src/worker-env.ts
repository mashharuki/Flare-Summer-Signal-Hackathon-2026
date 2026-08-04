import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function workerEnvFilePath(moduleUrl: string): string {
  return fileURLToPath(new URL("../.env", moduleUrl));
}

/** Loads only the worker package's private .env file, when it exists. */
export function loadWorkerEnvironment(input?: {
  readonly envFilePath?: string;
  readonly exists?: (path: string) => boolean;
  readonly load?: (path: string) => void;
}): string | undefined {
  const envFilePath = input?.envFilePath ?? workerEnvFilePath(import.meta.url);
  const exists = input?.exists ?? existsSync;
  if (!exists(envFilePath)) {
    return undefined;
  }
  const load = input?.load ?? process.loadEnvFile;
  load(envFilePath);
  return envFilePath;
}
