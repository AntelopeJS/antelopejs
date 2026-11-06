import { createServer, type Server } from "node:http";
import { message } from "./message";

let server: Server | undefined;
/** The configuration the project gives the fixture module. */
export interface FixtureConfig {
  secret?: string;
}

let config: FixtureConfig | undefined;

export function construct(received?: FixtureConfig): void {
  config = received;
}

export function start(): void {
  server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ module: "verify-http-fixture", message, config }));
  });
  server.listen(Number(process.env.VERIFY_FIXTURE_PORT));
}

export function stop(): void {
  server?.close();
  server = undefined;
}

export function destroy(): void {}
