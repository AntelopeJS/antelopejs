import sinon from "sinon";
import { REPLServer } from "node:repl";
import { expect } from "chai";

import { ReplSession } from "../../../src/core/repl/repl-session";

describe("ReplSession", () => {
  it("should start and close a repl session with context", () => {
    const closeSpy = sinon.spy();
    const context: REPLServer["context"] = {};
    let capturedPrompt = "";

    const replFactory = (prompt?: string) => {
      capturedPrompt = prompt ?? "";
      return Object.assign(sinon.createStubInstance(REPLServer), {
        context,
        close: closeSpy,
      });
    };

    const session = new ReplSession({ moduleManager: "mm" }, replFactory);
    const server = session.start("> ");

    expect(server).to.not.equal(undefined);
    expect(capturedPrompt).to.equal("> ");
    expect(context.moduleManager).to.equal("mm");

    session.close();
    expect(closeSpy.calledOnce).to.equal(true);
  });
});
