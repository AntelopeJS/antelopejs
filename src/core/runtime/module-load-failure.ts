import {
  CliError,
  describeFailure,
  getProcessTasks,
  pluralize,
} from "../output";

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
export function moduleLoadFailure(failures: unknown[], total: number) {
  if (failures.length === 1) {
    return failures[0];
  }
  const tasks = getProcessTasks();
  failures.forEach((failure) => {
    const problem = describeFailure(failure, false);
    tasks.message("error", problem.title, { detail: problem.reason });
  });
  return new CliError(
    {
      title: `Could not load ${failures.length} of ${pluralize(total, "module")}`,
      fixes: uniqueFixes(failures),
    },
    { cause: failures[0] },
  );
}
