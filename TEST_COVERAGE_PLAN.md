# Test Coverage Plan (Target: 80% global)

Date: 2026-01-31

## Context

- Current tools: Mocha + Chai + Sinon + c8.
- Current report: `coverage/index.html` (existing local report).
- Primary weak areas: `src/core/cli/**` commands and helpers.

## Goals

- Reach >= 80% global coverage (statements, lines, functions, branches).
- Improve both runtime core and CLI coverage without flakiness.
- Keep default test suite offline; add optional "online" tests behind a flag.

## Decisions (confirmed)

- Add `test:coverage:80` (keep current 95% target for future).
- Default tests are offline; optional online suite with `ONLINE=1`.
- Create this plan in a new file.

## Strategy

- Use unit tests with stubs for I/O-heavy paths.
- Add a few integration tests in temp dirs (CLI init/imports/exports).
- Prioritize lowest-coverage files to gain fast improvements.

## Phase 0 - Baseline and Targets (complete)

- [x] Extract initial lowest-coverage files from existing report.
- [x] Regenerate coverage with `pnpm test:coverage` (fails 95% threshold, report updated).
- [x] Capture updated "top 20 low coverage" list for prioritization.

## Phase 1 - Test Harness (pending)

- [ ] Add `test/helpers/*` (temp dirs, fs helpers, CLI runner, output capture).
- [ ] Add shared stubs for `fs`, `child_process`, `inquirer`, `process`.
- [ ] Define "online" test gating via `ONLINE=1`.

## Phase 2 - CLI Commands (pending)

- [ ] `src/core/cli/commands/module/imports/*` (add/list/update/remove/install).
- [ ] `src/core/cli/commands/module/exports/*` (set/generate).
- [ ] `src/core/cli/commands/project/*` (init/run/modules/logging).
- [ ] `src/core/cli/commands/config/*` (show/get/set/reset).

## Phase 3 - CLI Infrastructure (pending)

- [ ] `src/core/cli/package-manager.ts`
- [ ] `src/core/cli/git-operations.ts`
- [ ] `src/core/cli/terminal-display.ts`
- [ ] `src/core/cli/logging-utils.ts`

## Phase 4 - Runtime Core (pending)

- [ ] Focus on branches/edge cases in `src/core/*` (module registry, lifecycle,
      resolution, filesystem, container).

## Phase 5 - Integration Scenarios (pending)

- [ ] CLI init project in temp dir.
- [ ] Module imports add/list/update/remove (offline).
- [ ] Exports generate (offline).
- [ ] Optional online variants behind `ONLINE=1`.

## Initial low-coverage targets (from existing report)

- `src/core/cli/commands/module/imports/update.ts` ~11.6%
- `src/core/cli/commands/module/init.ts` ~12.0%
- `src/core/cli/commands/module/imports/install.ts` ~13.1%
- `src/core/cli/commands/project/init.ts` ~14.1%
- `src/core/cli/commands/module/imports/add.ts` ~14.9%
- `src/core/cli/commands/project/logging/set.ts` ~15.1%
- `src/core/cli/commands/module/imports/remove.ts` ~17.2%
- `src/core/cli/commands/project/modules/install.ts` ~17.3%
- `src/core/cli/commands/project/modules/update.ts` ~17.4%
- `src/core/cli/commands/module/imports/list.ts` ~18.0%
- `src/core/cli/commands/module/exports/generate.ts` ~18.0%
- `src/core/cli/commands/project/modules/remove.ts` ~18.7%
- `src/core/cli/commands/config/reset.ts` ~19.2%
- `src/core/cli/commands/project/modules/list.ts` ~20.0%
- `src/core/cli/commands/project/logging/show.ts` ~20.7%
- `src/core/cli/git-operations.ts` ~20.9%

## Notes

- Latest baseline from `pnpm test:coverage` on 2026-01-31:
  - Statements: 47.6%
  - Lines: 47.6%
  - Functions: 69.16%
  - Branches: 80.38%
  - Failure reason: global threshold currently set to 95%.
