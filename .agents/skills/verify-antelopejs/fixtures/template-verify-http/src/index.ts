import { createServer, type Server } from "node:http";
import { message } from "./message";

let server: Server | undefined;

export function construct(): void {}

export function start(): void {
  server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ module: "verify-http-fixture", message }));
  });
  server.listen(Number(process.env.VERIFY_FIXTURE_PORT));
}

export function stop(): void {
  server?.close();
  server = undefined;
}

export function destroy(): void {}
