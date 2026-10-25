import { pluralize } from "../cli/output/format";
import { CliError } from "../cli/output/errors";
import { describeFailure } from "../cli/output/failures";
import { getProcessTasks } from "../cli/output/tasks";

function uniqueFixes(failures: unknown[]): string[] {
  const fixes = failures.flatMap(
    (failure) => describeFailure(failure, false).fixes ?? [],
  );
  return [...new Set(fixes)];
}

/**
 * One error for every module that failed to load. A single failure is
 * thrown as is; several are each listed once, by title and reason, and
 * summed up by one error carrying their fixes and the first one as cause.
 */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- A single module rejection must be rethrown unchanged, even when it is not an Error.
export function moduleLoadFailure(failures: unknown[], total: number): unknown {
  if (failures.length === 1) {
    return failures[0];
  }
  const tasks = getProcessTasks();
  failures.forEach((failure) => {
    const problem = describeFailure(failure, false);
    tasks.message("error", problem.title, { detail: problem.reason });
  });
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- The same function returns an arbitrary original rejection for a single failure, so its return cannot be narrowed to CliError.
  return new CliError(
    {
      title: `Could not load ${failures.length} of ${pluralize(total, "module")}`,
      fixes: uniqueFixes(failures),
    },
    { cause: failures[0] },
  );
}
