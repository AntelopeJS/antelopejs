import { Logging } from "@antelopejs/interface-core/logging";

const Logger = new Logging.Channel("loader");
const WARNING_KEY_SEPARATOR = "\0";
const warned = new Set<string>();

/**
 * Warns once per consumer/owner pair that a module reaches into the runtime
 * package of another module.
 *
 * The evaluation still happens, and the resolver attributes it to the owning
 * module, but the import itself breaks the convention that modules only depend
 * on interface packages: the consumer holds symbols whose identity changes
 * whenever the owner reloads.
 */
export function warnForeignPackageEvaluationOnce(
  consumerId: string,
  ownerId: string,
  filePath: string,
): void {
  const key = `${consumerId}${WARNING_KEY_SEPARATOR}${ownerId}`;
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  Logger.Warn(
    `Module '${consumerId}' evaluates files of module '${ownerId}' ` +
      `('${filePath}'); their registrations are attributed to '${ownerId}'. ` +
      `Reach such symbols through the interface package instead of the runtime package.`,
  );
}

export function clearForeignPackageWarnings(): void {
  warned.clear();
}
