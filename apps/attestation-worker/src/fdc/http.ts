type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class HttpRequestError extends Error {
  public constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

function connectionDetail(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown connection error";
  }
  if ("cause" in error && error.cause instanceof Error && error.cause.message) {
    return error.cause.message;
  }
  return error.message;
}

export function normalizeHttpsBaseUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS origin.`);
  }

  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`${name} must be an HTTPS origin without a path or query.`);
  }
  return url.origin;
}

export async function fetchJson(
  label: string,
  url: string,
  init: RequestInit,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch (error) {
    throw new Error(
      `${label} request to ${url} failed before receiving an HTTP response: ${connectionDetail(error)}`,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new HttpRequestError(
      response.status,
      `${label} request to ${url} failed with HTTP ${response.status} ${response.statusText}.`,
    );
  }
  return response.json();
}
