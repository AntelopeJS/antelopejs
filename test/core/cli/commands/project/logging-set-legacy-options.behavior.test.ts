import { expect } from "chai";

import cmdSet from "../../../../../src/core/cli/commands/project/logging/set";
import {
  messagesOf,
  runSet,
  stubSetCommand,
  useSetCommandSandbox,
} from "../../../../helpers/logging-set-command";

const LEGACY_SPELLINGS = [
  ["--enableModuleTracking", "--enable-module-tracking"],
  ["--includeModule", "--include-module"],
  ["--dateFormat", "--date-format"],
];

describe("project logging set camelCase spellings", () => {
  useSetCommandSandbox(false);

  it("still applies the camelCase spellings", async () => {
    const config: any = { name: "test-project" };
    stubSetCommand(config);

    await runSet(
      "--enableModuleTracking",
      "--includeModule",
      "modA",
      "--dateFormat",
      "yyyy",
    );

    expect(config.logging.moduleTracking).to.include({ enabled: true });
    expect(config.logging.moduleTracking.includes).to.deep.equal(["modA"]);
    expect(config.logging.dateFormat).to.equal("yyyy");
  });

  it("warns that each camelCase spelling is deprecated", async () => {
    const stubs = stubSetCommand({ name: "test-project" });

    await runSet(
      "--enableModuleTracking",
      "--includeModule",
      "modA",
      "--dateFormat",
      "yyyy",
    );

    expect(messagesOf(stubs.warning)).to.deep.equal(
      LEGACY_SPELLINGS.map(
        ([legacy, current]) =>
          `${legacy} is deprecated, use ${current} instead`,
      ),
    );
  });

  it("does not warn for the kebab-case spellings", async () => {
    const stubs = stubSetCommand({ name: "test-project" });

    await runSet("--enable-module-tracking", "--include-module", "modA");

    expect(stubs.warning.called).to.equal(false);
  });

  it("lists only the kebab-case spellings in the help", () => {
    const help = cmdSet().helpInformation();

    LEGACY_SPELLINGS.forEach(([legacy, current]) => {
      expect(help).to.include(current);
      expect(help).to.not.include(legacy);
    });
  });
});
