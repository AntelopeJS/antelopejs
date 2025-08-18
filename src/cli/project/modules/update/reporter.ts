import chalk from 'chalk';
import { success, info, warning } from '../../../../utils/cli-ui';

export type UpdateStatus = 'notFound' | 'skipped' | 'current' | 'updated';

export interface ModuleUpdateResult {
  name: string;
  status: UpdateStatus;
  current?: string;
  latest?: string;
}

export class UpdateReport {
  private results: ModuleUpdateResult[] = [];

  add(result: ModuleUpdateResult) {
    this.results.push(result);
  }

  hasUpdates(): boolean {
    return this.results.some((r) => r.status === 'updated');
  }

  render() {
    const byStatus = groupBy(this.results, (r) => r.status);

    this.renderUpdates(byStatus.updated || []);
    this.renderCurrent(byStatus.current || []);
    this.renderNotFound(byStatus.notFound || []);
    this.renderSkipped(byStatus.skipped || []);
  }

  private renderUpdates(updated: ModuleUpdateResult[]) {
    if (updated.length === 0) {
      success(chalk.green`All modules are up to date!`);
      return;
    }
    success(chalk.green`Updated ${updated.length} module(s):`);
    updated.forEach(({ name, current, latest }) =>
      info(`  ${chalk.green('•')} ${name}: ${chalk.dim(current!)} → ${latest!}`),
    );
  }

  private renderCurrent(current: ModuleUpdateResult[]) {
    current.forEach(({ name, current: v }) => info(`${chalk.bold(name)}: ${chalk.green('Already up to date')} (${v})`));
  }

  private renderNotFound(notFound: ModuleUpdateResult[]) {
    if (notFound.length === 0) return;
    warning(chalk.yellow`${notFound.length} module(s) not found in project:`);
    notFound.forEach(({ name }) => info(`  ${chalk.yellow('•')} ${chalk.bold(name)}`));
  }

  private renderSkipped(skipped: ModuleUpdateResult[]) {
    skipped.forEach(({ name }) => info(`${chalk.bold(name)}: Skipped (not an npm package)`));
  }
}

export function renderReport(report: UpdateReport, dryRun: boolean) {
  if (dryRun) warning(chalk.yellow`Dry run - no changes were made`);

  report.render();

  if (report.hasUpdates() && !dryRun) {
    info(`Run ${chalk.bold('ajs project run')} to use the updated modules.`);
  }
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return arr.reduce(
    (acc, item) => {
      const key = keyFn(item);
      (acc[key] ||= []).push(item);
      return acc;
    },
    {} as Record<string, T[]>,
  );
}
