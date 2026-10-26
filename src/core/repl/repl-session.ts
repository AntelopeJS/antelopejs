import repl, { type REPLServer } from "node:repl";

export type ReplFactory = (prompt?: string) => REPLServer;

export class ReplSession {
  private server?: REPLServer;

  constructor(
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exported REPL sessions accept arbitrary host bindings; narrowing this context changes their constructor contract.
    private context: Record<string, unknown> = {},
    private createRepl: ReplFactory = repl.start,
  ) {}

  start(prompt: string = "> "): REPLServer {
    this.server = this.createRepl(prompt);
    Object.assign(this.server.context, this.context);
    return this.server;
  }

  close(): void {
    this.server?.close();
  }
}
