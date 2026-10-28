import fc from "fast-check";
import assert from "node:assert/strict";
import path from "node:path";
import { satisfies, validRange } from "semver";
import { InterfaceResolutionError } from "../../src/core/output";
import {
  consumerRange,
  interfaceVersion,
  rangeCheckParameters,
  rangeConsumer,
} from "../helpers/interface-range-generators";
import {
  constructRangeProject,
  type RangeConsumer,
} from "../helpers/interface-range-project";

function conflicts(version: string, range: string): boolean {
  return (
    range !== "" && validRange(range) !== null && !satisfies(version, range)
  );
}

const boundaryCases: [string, string][] = [
  ["1.2.3-alpha.0", "*"],
  ["1.2.3-alpha.0+build.0", ">=1.2.3-alpha.0 <1.2.3"],
  ["1.2.3+sha.abc123", "=1.2.3"],
  ["0.2.4", "^0.2.3"],
  ["0.3.0", "^0.2.3"],
  ["0.0.4", "^0.0.3"],
  ["1.3.0", "~1.2.3"],
  ["1.2.4", "1.2.x"],
  ["2.0.0", "1.x"],
  ["2.3.4", "1.2.3 - 2.3.4"],
  ["2.3.5", "1.2.3 - 2.3.4"],
  ["3.1.0", "^1.0.0 || ~3.1.0"],
  ["2.0.0", "not-a-range"],
  ["1.0.0-alpha.0", ""],
  ["1.0.0-alpha.0", " "],
];

describe("ModuleManager interface range properties", function () {
  this.timeout(60000);

  it("matches semver without admitting prereleases or rejecting invalid declarations", async () => {
    await fc.assert(
      fc.asyncProperty(
        interfaceVersion,
        consumerRange,
        async (version, range) => {
          const { error, packageName, canonicalRoot } =
            await constructRangeProject(
              version,
              [{ range, optional: false, copy: "private" }],
              false,
            );
          if (!conflicts(version, range)) {
            assert.equal(error, undefined);
            return;
          }
          assert.ok(error instanceof InterfaceResolutionError);
          assert.deepEqual(
            error.conflicts.rangeConflicts.map((entry) => ({
              moduleId: entry.moduleId,
              packageName: entry.packageName,
              range: entry.range,
              canonical: {
                version: entry.canonical.version,
                root: entry.canonical.root,
              },
              consumerVersion: entry.consumerCopy?.version,
            })),
            [
              {
                moduleId: "consumer-0",
                packageName,
                range,
                canonical: { version, root: canonicalRoot },
                consumerVersion: "9.9.9",
              },
            ],
          );
          assert.deepEqual(error.conflicts.preloadedCopies, []);
        },
      ),
      { ...rangeCheckParameters, examples: boundaryCases },
    );
  });
});

describe("ModuleManager interface range properties", function () {
  this.timeout(60000);

  it("rejects exactly the conflicting or preloaded consumers without dropping or inventing entries", async () => {
    await fc.assert(
      fc.asyncProperty(
        interfaceVersion,
        fc.array(rangeConsumer, { maxLength: 6 }),
        fc.boolean(),
        async (version, consumers, reverse) => {
          const result = await constructRangeProject(
            version,
            consumers,
            reverse,
          );
          const expectedRanges = consumers.flatMap((consumer, index) =>
            conflicts(version, consumer.range)
              ? [{ moduleId: `consumer-${index}`, range: consumer.range }]
              : [],
          );
          const expectedPreloaded = consumers.flatMap((consumer, index) =>
            consumer.range !== "" && consumer.copy === "preloaded"
              ? [`consumer-${index}`]
              : [],
          );
          if (expectedRanges.length === 0 && expectedPreloaded.length === 0) {
            assert.equal(result.error, undefined);
            return;
          }
          assert.ok(result.error instanceof InterfaceResolutionError);
          const { rangeConflicts, preloadedCopies } = result.error.conflicts;
          assert.deepEqual(
            rangeConflicts
              .map(({ moduleId, range }) => ({ moduleId, range }))
              .sort((left, right) =>
                left.moduleId.localeCompare(right.moduleId),
              ),
            expectedRanges,
          );
          assert.deepEqual(
            preloadedCopies.map(({ moduleId }) => moduleId).sort(),
            expectedPreloaded,
          );
          for (const entry of [...rangeConflicts, ...preloadedCopies]) {
            assert.equal(entry.packageName, result.packageName);
            assert.deepEqual(
              { version: entry.canonical.version, root: entry.canonical.root },
              {
                version,
                root: result.canonicalRoot,
              },
            );
          }
          for (const entry of preloadedCopies) {
            const index = consumers.findIndex(
              (_, i) => entry.moduleId === `consumer-${i}`,
            );
            assert.deepEqual(
              { version: entry.copy.version, root: entry.copy.root },
              {
                version: "9.9.9",
                root: result.consumerRoots[index],
              },
            );
            assert.equal(
              entry.loadedFile,
              path.join(result.consumerRoots[index], "dist", "index.js"),
            );
          }
        },
      ),
      {
        ...rangeCheckParameters,
        examples: [
          [
            "2.0.0",
            [
              { range: "^1.0.0", optional: false, copy: "missing" },
              { range: "^1.0.0", optional: true, copy: "private" },
              { range: "*", optional: false, copy: "preloaded" },
              { range: "invalid", optional: true, copy: "canonical-preloaded" },
            ] satisfies RangeConsumer[],
            true,
          ],
          [
            "1.0.0",
            [
              { range: "*", optional: true, copy: "preloaded" },
            ] satisfies RangeConsumer[],
            false,
          ],
          ["1.0.0", [], false],
        ],
      },
    );
  });
});
