import { expect } from "chai";

import { createMemoryUi } from "../../../helpers/memory-ui";

interface PackageRow {
  name: string;
  version: string;
}

const PACKAGES: PackageRow[] = [
  { name: "auth", version: "1.2.0" },
  { name: "inventory-core", version: "10.0.1" },
];

const PACKAGE_COLUMNS = [
  { header: "Name", value: (row: PackageRow) => row.name },
  { header: "Version", value: (row: PackageRow) => row.version },
];

interface ModuleRow {
  name: string;
  source: string;
  reference: string;
}

const LONG_REFERENCE = "https://example.com/acme/payments-connector.git";

const MODULES: ModuleRow[] = [
  { name: "payments-connector", source: "git", reference: LONG_REFERENCE },
  { name: "api", source: "npm", reference: "^1.0.0" },
];

const MODULE_COLUMNS = [
  { header: "Name", value: (row: ModuleRow) => row.name },
  { header: "Source", value: (row: ModuleRow) => row.source },
  { header: "Reference", value: (row: ModuleRow) => row.reference },
];

describe("output ui tables", () => {
  it("aligns columns under dim uppercase headers on a terminal", () => {
    const { ui, result } = createMemoryUi({
      hasColor: true,
      isTerminal: true,
    });

    ui.table(PACKAGES, PACKAGE_COLUMNS);

    expect(result.text).to.equal(
      [
        "\x1b[2mNAME            VERSION\x1b[22m",
        "auth            1.2.0",
        "inventory-core  10.0.1",
        "",
      ].join("\n"),
    );
  });

  it("prints tab-separated rows without headers when piped", () => {
    const { ui, result } = createMemoryUi();

    ui.table(PACKAGES, PACKAGE_COLUMNS);

    expect(result.text).to.equal("auth\t1.2.0\ninventory-core\t10.0.1\n");
  });

  it("cuts the widest columns but the first to fit the terminal", () => {
    const { ui, result } = createMemoryUi({ isTerminal: true, columns: 46 });

    ui.table(MODULES, MODULE_COLUMNS);

    expect(result.text).to.equal(
      [
        "NAME                SOURCE  REFERENCE",
        "payments-connector  git     https://example.c…",
        "api                 npm     ^1.0.0",
        "",
      ].join("\n"),
    );
    result.text
      .split("\n")
      .forEach((line) => expect(line.length).to.be.at.most(46));
  });

  it("cuts with the ASCII ellipsis when the terminal has no Unicode", () => {
    const { ui, result } = createMemoryUi({
      isTerminal: true,
      hasUnicode: false,
      columns: 46,
    });

    ui.table(MODULES, MODULE_COLUMNS);

    expect(result.text).to.contain("https://example...\n");
  });

  it("writes one block per row when the terminal is too narrow", () => {
    const { ui, result } = createMemoryUi({ isTerminal: true, columns: 30 });

    ui.table(MODULES, MODULE_COLUMNS);

    expect(result.text).to.equal(
      [
        "NAME       payments-connector",
        "SOURCE     git",
        `REFERENCE  ${LONG_REFERENCE}`,
        "",
        "NAME       api",
        "SOURCE     npm",
        "REFERENCE  ^1.0.0",
        "",
      ].join("\n"),
    );
  });
});
