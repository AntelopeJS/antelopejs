import path from "node:path";

/** A feature as the break-coverage rule needs it: its name and its covers globs. */
export interface CoveringFeature {
  name: string;
  file: string;
  covers: string[];
}

/**
 * The files each feature's seeded break edits that the feature's own covers
 * globs miss, one line per file. `plan` maps a diff to features through
 * those globs, so a break outside them would never run its own journeys.
 * The smoke feature runs on every verdict and is exempt.
 */
export function breakCoverageProblems(features: CoveringFeature[], breakFiles: (feature: string) => string[], smoke: string): string[] {
  return features
    .filter((feature) => feature.name !== smoke)
    .flatMap((feature) =>
      breakFiles(feature.name)
        .filter((file) => !feature.covers.some((glob) => path.matchesGlob(file, glob)))
        .map((file) => `${feature.file}: its seeded break edits ${file}, which its covers globs miss, so plan would not run it`),
    );
}
