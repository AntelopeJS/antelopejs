/** The version `versions` declares for `packageName`, ignoring inherited keys. */
export function ownVersion(
  versions: Record<string, string> | undefined,
  packageName: string,
): string | undefined {
  return versions && Object.hasOwn(versions, packageName)
    ? versions[packageName]
    : undefined;
}
