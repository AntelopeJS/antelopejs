import { expect } from "chai";

import {
  describeUnresolvedImport,
  unresolvedImportWarning,
} from "../../../../../../src/cli";

describe("unresolved import reporting", () => {
  it("names the interface, its version and the requiring module", () => {
    expect(
      describeUnresolvedImport({
        interfacePackage: "@antelopejs/interface-redis",
        moduleId: "dms-saas",
        version: ">=0.0.1 <1.0.0",
      }),
    ).to.equal(
      "@antelopejs/interface-redis@>=0.0.1 <1.0.0 (required by dms-saas)",
    );
  });

  it("omits the version when the module declares none", () => {
    expect(
      describeUnresolvedImport({
        interfacePackage: "@antelopejs/interface-redis",
        moduleId: "dms-saas",
      }),
    ).to.equal("@antelopejs/interface-redis (required by dms-saas)");
  });

  it("names the interface in the no-implementation warning", () => {
    expect(
      unresolvedImportWarning(
        {
          interfacePackage: "@antelopejs/interface-redis",
          moduleId: "dms-saas",
          version: "^1.0.0",
        },
        "https://github.com/AntelopeJS/interfaces.git",
      ),
    ).to.equal(
      "@antelopejs/interface-redis@^1.0.0 (required by dms-saas): no module found implementing it in repository https://github.com/AntelopeJS/interfaces.git",
    );
  });
});
