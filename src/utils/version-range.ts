import { parse, satisfies } from "semver";

/**
 * Whether `range` admits `version`. A version passes under semver's default
 * rules. It also passes as a prerelease when the range admits both the
 * prerelease and the release it precedes. So a range admits
 * `0.5.2-next.113` as a preview of `0.5.2`, and `<0.6.0` still refuses
 * `0.6.0-next.1`. A string that is no valid semver passes no range.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parse(version);
  if (!parsed) {
    return false;
  }
  return (
    satisfies(parsed, range) ||
    (satisfies(parsed, range, { includePrerelease: true }) &&
      satisfies(`${parsed.major}.${parsed.minor}.${parsed.patch}`, range))
  );
}
