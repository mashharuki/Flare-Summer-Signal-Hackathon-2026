import { createServer, type IncomingHttpHeaders } from "node:http";

import type { AttestationApi } from "./attestation-api.js";

export interface FetchRequestInput {
  readonly body?: string;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly method: string;
  readonly url: string;
}

export function toFetchRequest(input: FetchRequestInput): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input.headers)) {
    if (typeof value === "string") {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    }
  }
  const host = headers.get("host") ?? "localhost";
  return new Request(`http://${host}${input.url}`, {
    ...(input.body === undefined ? {} : { body: input.body }),
    headers,
    method: input.method,
  });
}

export function applyCors(
  response: Response,
  request: Request,
  allowedOrigin: string | undefined,
): Response {
  const headers = new Headers(response.headers);
  if (allowedOrigin && request.headers.get("origin") === allowedOrigin) {
    headers.set("access-control-allow-origin", allowedOrigin);
    headers.set(
      "access-control-allow-headers",
      "content-type, x-reserveflow-address, x-reserveflow-expires-at, x-reserveflow-signature",
    );
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    headers.set("vary", "origin");
  }
  return new Response(response.body, { headers, status: response.status });
}

export function startAttestationHttpServer(input: {
  readonly allowedOrigin?: string;
  readonly api: AttestationApi;
  readonly port: number;
}): ReturnType<typeof createServer> {
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const fetchRequest = toFetchRequest({
      ...(body === undefined ? {} : { body }),
      headers: request.headers,
      method: request.method ?? "GET",
      url: request.url ?? "/",
    });
    const apiResponse =
      fetchRequest.method === "OPTIONS"
        ? new Response(null, { status: 204 })
        : await input.api.handle(fetchRequest);
    const corsResponse = applyCors(
      apiResponse,
      fetchRequest,
      input.allowedOrigin,
    );
    const bytes = new Uint8Array(await corsResponse.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    corsResponse.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });
    response.writeHead(corsResponse.status, responseHeaders);
    response.end(bytes);
  });
  server.listen(input.port);
  return server;
}

async function readBody(
  request: AsyncIterable<Uint8Array>,
): Promise<string | undefined> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export type NodeHeaders = IncomingHttpHeaders;
