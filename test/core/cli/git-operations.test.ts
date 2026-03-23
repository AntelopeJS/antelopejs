import {
  copyTemplate,
  loadInterfaceFromGit,
  loadInterfacesFromGit,
  loadManifestFromGit,
} from "../../../src/core/cli/git-operations";

describe("Git Operations", () => {
  it("exposes the git helper functions", async () => {
    await Promise.all([
      Promise.resolve(copyTemplate),
      Promise.resolve(loadManifestFromGit),
      Promise.resolve(loadInterfaceFromGit),
      Promise.resolve(loadInterfacesFromGit),
    ]);
  });
});
