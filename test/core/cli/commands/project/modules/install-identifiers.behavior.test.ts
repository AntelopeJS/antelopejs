import type {
  ModuleSourceGit,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { expect } from "chai";

import { resolveInstallIdentifier } from "../../../../../../src/cli";

describe("resolveInstallIdentifier", () => {
  it("appends the manifest version to package identifiers", () => {
    const source: ModuleSourcePackage = {
      type: "package",
      package: "modA",
      version: "^1.0.0",
    };
    expect(resolveInstallIdentifier(source, "modA")).to.equal("modA@^1.0.0");
  });

  it("keeps package identifiers unchanged when the manifest omits the version", () => {
    const source: Omit<ModuleSourcePackage, "version"> = {
      type: "package",
      package: "modA",
    };
    expect(resolveInstallIdentifier(source, "modA")).to.equal("modA");
  });

  it("keeps non-package identifiers unchanged", () => {
    const source: ModuleSourceGit = {
      type: "git",
      remote: "https://example.com/repo.git",
    };
    expect(
      resolveInstallIdentifier(source, "https://example.com/repo.git"),
    ).to.equal("https://example.com/repo.git");
  });
});
