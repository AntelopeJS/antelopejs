import repl, { type REPLServer } from "node:repl";

import type { UnknownDictionary } from "../../utils";

export type ReplFactory = (prompt?: string) => REPLServer;

export class ReplSession {
  private server?: REPLServer;

  constructor(
    private context: UnknownDictionary = {},
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
