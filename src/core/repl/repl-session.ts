import repl, { REPLServer } from 'repl';

export type ReplFactory = (prompt?: string) => REPLServer;

export class ReplSession {
  private server?: REPLServer;

  constructor(
    private context: Record<string, unknown> = {},
    private createRepl: ReplFactory = repl.start
  ) {}

  start(prompt: string = '> '): REPLServer {
    this.server = this.createRepl(prompt);
    Object.assign(this.server.context, this.context);
    return this.server;
  }

  close(): void {
    this.server?.close();
  }
}
