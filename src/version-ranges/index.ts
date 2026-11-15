import { parse, satisfies, validRange } from "semver";

/**
 * Whether `range` admits `version`. A version passes under semver's default
 * rules. It also passes as a prerelease when the range admits both the
 * prerelease and the release it precedes. So a range admits
 * `0.5.2-next.113` as a preview of `0.5.2`, while `<0.6.0` refuses
 * `0.6.0-next.1` and `^0.5.1` refuses `0.5.1-next.1`. A string that is no
 * valid semver, or no valid range, admits nothing.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parse(version);
  const normalized = validRange(range);
  if (!parsed || normalized === null) {
    return false;
  }
  return (
    satisfies(parsed, normalized) ||
    (satisfies(parsed, normalized, { includePrerelease: true }) &&
      satisfies(`${parsed.major}.${parsed.minor}.${parsed.patch}`, normalized))
  );
}
