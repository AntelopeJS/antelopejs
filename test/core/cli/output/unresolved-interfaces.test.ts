import { expect } from "chai";

import {
  FAILURE_EXIT_CODE,
  reportFailure,
  UnresolvedInterfacesError,
} from "../../../../src/core/output";
import { createMemoryUi } from "../../../helpers/memory-ui";

const INSTALL_FIX =
  "Run 'ajs project modules install' to resolve missing dependencies.";

function unresolvedError(): UnresolvedInterfacesError {
  return new UnresolvedInterfacesError([
    { moduleId: "greeter-consumer", interfacePackage: "verify-greeter" },
    { moduleId: "billing", interfacePackage: "@acme/interface-payments" },
  ]);
}

describe("unresolved interface translation", () => {
  it("prints each module and the interface it requires without --verbose", () => {
    const { ui, feedback } = createMemoryUi({ hasUnicode: false });

    const exitCode = reportFailure(unresolvedError(), ui, false);

    expect(feedback.text).to.equal(
      [
        "x Unresolved interface dependencies",
        "  No loaded module implements these required interfaces:",
        "  greeter-consumer requires verify-greeter",
        "  billing requires @acme/interface-payments",
        `  > ${INSTALL_FIX}`,
        "",
      ].join("\n"),
    );
    expect(exitCode).to.equal(FAILURE_EXIT_CODE);
  });
});

describe("UnresolvedInterfacesError", () => {
  it("keeps each module and the interface it requires in its message", () => {
    const error = unresolvedError();

    expect(error.name).to.equal("UnresolvedInterfacesError");
    expect(error.message.split("\n")).to.deep.equal([
      "Unresolved interface dependencies:",
      "  - greeter-consumer requires verify-greeter",
      "  - billing requires @acme/interface-payments",
      "",
      INSTALL_FIX,
    ]);
  });
});
