import path from "node:path";

import type { Journey, JourneyResult } from "./journey.mts";
import { runLimited } from "./pool.mts";

/** A feature to run: its journeys in registered order, and why they must not overlap when they must not. */
export interface FeatureRun {
  feature: string;
  journeys: readonly Journey[];
  serial?: string;
}

/** What a feature's journeys produced, in registered order; `error` is set when recording them failed. */
export interface FeatureOutcome {
  feature: string;
  results: JourneyResult[];
  error?: string;
}

function crashed(feature: string, journey: Journey, error: string): JourneyResult {
  return {
    feature,
    journey: journey.id,
    title: journey.title,
    entryPoint: journey.entryPoint,
    status: "FAIL",
    steps: [],
    error,
    folder: path.join(feature, journey.id),
  };
}

/**
 * Runs every journey of `runs` on one pool of `limit` tasks, in the order
 * given, so a slow feature's journeys overlap each other and the other
 * features'. A feature with a `serial` reason is one task that runs its
 * journeys one after another. A journey that throws becomes a failed result
 * and does not stop the rest.
 *
 * The outcomes come back in the order of `runs`. Each resolves when its own
 * feature's last journey has finished, after `record` has been called once
 * with the results in registered order, whatever order the journeys finished in.
 */
export function scheduleFeatures(
  runs: readonly FeatureRun[],
  limit: number,
  runOne: (feature: string, journey: Journey) => Promise<JourneyResult>,
  record: (feature: string, results: JourneyResult[]) => void,
): Promise<FeatureOutcome>[] {
  const attempt = async (feature: string, journey: Journey): Promise<JourneyResult> => {
    try {
      return await runOne(feature, journey);
    } catch (failure) {
      return crashed(feature, journey, failure instanceof Error ? (failure.stack ?? failure.message) : String(failure));
    }
  };
  const tasks: (() => Promise<JourneyResult[]>)[] = [];
  const spans = runs.map((run) => {
    const first = tasks.length;
    if (run.serial === undefined) {
      for (const journey of run.journeys) {
        tasks.push(async () => [await attempt(run.feature, journey)]);
      }
    } else {
      tasks.push(async () => {
        const results: JourneyResult[] = [];
        for (const journey of run.journeys) {
          results.push(await attempt(run.feature, journey));
        }
        return results;
      });
    }
    return { first, end: tasks.length };
  });
  const started = runLimited(tasks, limit);
  return runs.map(async ({ feature }, index) => {
    const { first, end } = spans[index];
    const results = (await Promise.all(started.slice(first, end))).flat();
    try {
      record(feature, results);
      return { feature, results };
    } catch (failure) {
      return { feature, results, error: failure instanceof Error ? (failure.stack ?? failure.message) : String(failure) };
    }
  });
}
