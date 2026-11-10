import { expect } from "chai";
import { REPLServer } from "node:repl";
import sinon from "sinon";

import { ModuleManager } from "../../../src/core/modules";
import { type ReplContext, ReplSession } from "../../../src/core/repl";

describe("ReplSession", () => {
  it("should start and close a repl session with context", () => {
    const closeSpy = sinon.spy();
    const context: Partial<ReplContext> = {};
    let capturedPrompt = "";

    const replFactory = (prompt?: string) => {
      capturedPrompt = prompt ?? "";
      const server: REPLServer = sinon.createStubInstance(REPLServer);
      return Object.assign(server, {
        context,
        close: closeSpy,
      });
    };

    const moduleManager = new ModuleManager();
    const session = new ReplSession({ moduleManager }, replFactory);
    const server = session.start("> ");

    expect(server).to.not.equal(undefined);
    expect(capturedPrompt).to.equal("> ");
    expect(context.moduleManager).to.equal(moduleManager);

    session.close();
    expect(closeSpy.calledOnce).to.equal(true);
  });
});
