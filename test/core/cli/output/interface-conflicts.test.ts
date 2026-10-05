import { expect } from "chai";

import {
  describeFailure,
  reportFailure,
  translateFailure,
} from "../../../../src/core/cli/output";
import { FAILURE_EXIT_CODE } from "../../../../src/core/cli/exit-codes";
import {
  InterfaceResolutionError,
  type InterfaceRangeConflict,
  type PreloadedInterfaceCopy,
} from "../../../../src/core/resolution/interface-resolution-error";
import { createMemoryUi } from "../../../helpers/memory-ui";

const PACKAGE_NAME = "@antelopejs/interface-core";
const SHARED_COPY = {
  version: "0.1.1",
  root: "/core/node_modules/@antelopejs/interface-core",
};
const LEGACY_COPY = {
  version: "0.0.3",
  root: "/project/modules/legacy/node_modules/@antelopejs/interface-core",
};
const UPDATE_LEGACY_FIX =
  "Update legacy to a release that supports @antelopejs/interface-core 0.1.1";
const WIDEN_LEGACY_RANGE_FIX =
  'Or depend on "@antelopejs/interface-core": "^0.1.1" in the package.json of legacy, then reinstall its dependencies';

function rangeConflict(
  overrides: Partial<InterfaceRangeConflict> = {},
): InterfaceRangeConflict {
  return {
    moduleId: "legacy",
    packageName: PACKAGE_NAME,
    range: "^0.0.3",
    canonical: SHARED_COPY,
    consumerCopy: LEGACY_COPY,
    ...overrides,
  };
}

function preloadedCopy(): PreloadedInterfaceCopy {
  return {
    moduleId: "legacy",
    packageName: PACKAGE_NAME,
    copy: LEGACY_COPY,
    canonical: SHARED_COPY,
    loadedFile: `${LEGACY_COPY.root}/dist/index.js`,
  };
}

function resolutionError(
  rangeConflicts: InterfaceRangeConflict[],
  preloadedCopies: PreloadedInterfaceCopy[] = [],
): InterfaceResolutionError {
  return new InterfaceResolutionError({ rangeConflicts, preloadedCopies });
}

describe("interface conflict translation", () => {
  it("names the module, the range it requires and the shared copy", () => {
    const problem = translateFailure(resolutionError([rangeConflict()]));

    expect(problem).to.deep.equal({
      title: "Incompatible interface package resolution",
      reason:
        "Modules share one copy of each interface package, and that copy does not work for these modules:",
      details: [
        "legacy requires @antelopejs/interface-core@^0.0.3, but the shared copy is 0.1.1",
        `  shared copy: ${SHARED_COPY.root}`,
        `  copy of legacy: 0.0.3 at ${LEGACY_COPY.root}`,
      ],
      fixes: [UPDATE_LEGACY_FIX, WIDEN_LEGACY_RANGE_FIX],
    });
  });

  it("says when the module has no copy of its own", () => {
    const problem = translateFailure(
      resolutionError([rangeConflict({ consumerCopy: undefined })]),
    );

    expect(problem?.details?.[2]).to.equal("  copy of legacy: not installed");
  });

  it("names the file of a copy loaded before the shared one", () => {
    const problem = translateFailure(resolutionError([], [preloadedCopy()]));

    expect(problem?.details).to.deep.equal([
      "The copy of @antelopejs/interface-core installed by legacy (0.0.3) was loaded before the shared copy (0.1.1) and cannot be redirected",
      `  loaded first: ${LEGACY_COPY.root}/dist/index.js`,
      `  shared copy: ${SHARED_COPY.root}`,
    ]);
    expect(problem?.fixes).to.deep.equal([
      "Make sure nothing loads @antelopejs/interface-core from legacy before AntelopeJS loads the modules",
    ]);
  });

  it("lists every conflict and suggests each fix once", () => {
    const problem = translateFailure(
      resolutionError([
        rangeConflict(),
        rangeConflict({ range: "~0.0.3" }),
        rangeConflict({ moduleId: "billing", range: "0.0.x" }),
      ]),
    );

    expect(problem?.details).to.have.length(9);
    expect(problem?.details?.[6]).to.equal(
      "billing requires @antelopejs/interface-core@0.0.x, but the shared copy is 0.1.1",
    );
    expect(problem?.fixes).to.deep.equal([
      UPDATE_LEGACY_FIX,
      WIDEN_LEGACY_RANGE_FIX,
      "Update billing to a release that supports @antelopejs/interface-core 0.1.1",
      'Or depend on "@antelopejs/interface-core": "^0.1.1" in the package.json of billing, then reinstall its dependencies',
    ]);
  });

  it("does not offer a trace without --verbose", () => {
    const details =
      describeFailure(resolutionError([rangeConflict()]), false).details ?? [];

    expect(details).to.have.length(3);
    expect(details.join("\n")).not.to.include("--verbose");
  });

  it("adds the stack trace with --verbose", () => {
    const details =
      describeFailure(resolutionError([rangeConflict()]), true).details ?? [];

    expect(details[3]).to.equal(
      "InterfaceResolutionError: Incompatible interface package resolution:",
    );
    expect(details.some((line) => line.includes("at "))).to.equal(true);
  });

  it("prints what failed, why and how to fix it", () => {
    const { ui, feedback } = createMemoryUi({ hasUnicode: false });

    const exitCode = reportFailure(
      resolutionError([rangeConflict()]),
      ui,
      false,
    );

    expect(feedback.text).to.equal(
      [
        "x Incompatible interface package resolution",
        "  Modules share one copy of each interface package, and that copy does not work for these modules:",
        "  legacy requires @antelopejs/interface-core@^0.0.3, but the shared copy is 0.1.1",
        `    shared copy: ${SHARED_COPY.root}`,
        `    copy of legacy: 0.0.3 at ${LEGACY_COPY.root}`,
        `  > ${UPDATE_LEGACY_FIX}`,
        `  > ${WIDEN_LEGACY_RANGE_FIX}`,
        "",
      ].join("\n"),
    );
    expect(exitCode).to.equal(FAILURE_EXIT_CODE);
  });
});

describe("InterfaceResolutionError", () => {
  it("keeps the full list of conflicts in its message", () => {
    const error = resolutionError([rangeConflict()], [preloadedCopy()]);

    expect(error.name).to.equal("InterfaceResolutionError");
    expect(error.message.split("\n")).to.deep.equal([
      "Incompatible interface package resolution:",
      `  - legacy requires @antelopejs/interface-core@^0.0.3, but the canonical package is 0.1.1 at ${SHARED_COPY.root} (consumer copy: 0.0.3 at ${LEGACY_COPY.root})`,
      `  - @antelopejs/interface-core@0.0.3 was loaded from ${LEGACY_COPY.root} before the canonical copy at ${SHARED_COPY.root}; preloaded interface copies cannot be redirected (${LEGACY_COPY.root}/dist/index.js)`,
    ]);
  });

  it("says when the consumer has no copy installed", () => {
    const error = resolutionError([rangeConflict({ consumerCopy: undefined })]);

    expect(error.message).to.include(
      "(consumer copy: not installed from the consumer)",
    );
  });
});
