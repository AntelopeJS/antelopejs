import fc from "fast-check";

const component = fc.integer({ min: 0, max: 4 });
const release = fc
  .tuple(component, component, component)
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);
const prerelease = fc.oneof(
  fc.constant(""),
  fc
    .tuple(fc.constantFrom("alpha", "beta", "rc"), component)
    .map(([label, number]) => `-${label}.${number}`),
  component.map((number) => `-${number}`),
);
const metadata = fc.constantFrom("", "+build.0", "+sha.abc123");

export const interfaceVersion = fc
  .tuple(release, prerelease, metadata)
  .map((parts) => parts.join(""));

export const consumerRange = fc.oneof(
  interfaceVersion,
  fc
    .tuple(fc.constantFrom("^", "~", ">=", "<", "="), interfaceVersion)
    .map(([operator, version]) => `${operator}${version}`),
  fc.tuple(component, component).map(([major, minor]) => `${major}.${minor}.x`),
  component.map((major) => `${major}.x`),
  fc.tuple(release, release).map(([lower, upper]) => `${lower} - ${upper}`),
  fc.tuple(release, release).map(([left, right]) => `^${left} || ~${right}`),
  fc.constantFrom(
    "*",
    "",
    " ",
    "not-a-range",
    "^",
    "1.2.3.4",
    "workspace:*",
    ">=oops",
  ),
);

export const rangeConsumer = fc.record({
  range: consumerRange,
  optional: fc.boolean(),
  copy: fc.constantFrom(
    "missing",
    "canonical",
    "private",
    "preloaded",
    "canonical-preloaded",
  ),
});

export const rangeCheckParameters = {
  seed: Number(process.env.FC_SEED ?? 20261028),
  numRuns: 250,
};
