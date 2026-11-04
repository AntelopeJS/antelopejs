/**
 * One TLC state of the spec, the variables of ModuleLifecycleState.tla as the
 * statechart skill hands them over. A TLA+ function of a generation or a launch
 * is an object keyed from 1, never an array.
 *
 * @typedef {object} LifecycleState
 * @property {boolean} exited
 * @property {boolean} crashed
 * @property {boolean} sigint
 * @property {boolean} staleRead
 * @property {string} configOwner
 * @property {number} launch
 * @property {number} nextGen
 * @property {Record<number, string>} lpc
 * @property {Record<number, string>} sd
 * @property {Record<number, string>} state
 * @property {Record<number, string>} gmod
 * @property {Record<number, Record<string, number>>} loaded
 * @property {Record<number, { pc: string, mod: string, repl: number, prev: number }>} rl
 */

export const readerActions = ["ConfigEdit", "SourceEdit", "Sigint"];

/** @type {Partial<Record<string, string>>} */
const RELOAD = {
  manifest: "loading new code",
  destroy: "destroying old generation",
  install: "installing new generation",
  construct: "constructing new generation",
  callStart: "starting new generation",
  starting: "starting new generation",
  cleanup: "cleaning up failed reload",
  recover: "restarting old generation",
  recovering: "restarting old generation",
};

/**
 * @param {LifecycleState} v
 * @returns {string}
 */
function context(v) {
  if (v.exited) return v.crashed ? "Process crashed" : "Process exited";
  const L = v.launch;
  const pc = v.lpc[L];
  if (v.sd[L] !== "none" && v.sd[L] !== "done") {
    if (v.sigint) return `Launch ${L} stopping on Ctrl+C`;
    if (v.crashed) return `Launch ${L} stopping after a crash`;
    return `Launch ${L} stopping for a config edit`;
  }
  if (v.sd[L] === "done") return `Launch ${L} stopped`;
  if (pc === "running") return `Launch ${L} running`;
  return `Launch ${L} starting`;
}

/**
 * @param {LifecycleState} v
 * @returns {string}
 */
function progress(v) {
  const busy = Object.values(v.rl).find((r) => r.pc !== "idle");
  const orphan = orphans(v).length > 0;
  const reload = busy
    ? `reloading ${busy.mod}, ${RELOAD[busy.pc]}`
    : "no reload";
  return orphan ? `${reload}, a generation outside the project runs` : reload;
}

/**
 * @param {LifecycleState} v
 * @returns {number[]}
 */
function orphans(v) {
  /** @type {number[]} */
  const found = [];
  for (let g = 1; g < v.nextGen; g++) {
    if (v.state[g] === "Loaded") continue;
    if (!Object.values(v.loaded).some((row) => row[v.gmod[g]] === g)) found.push(g);
  }
  return found;
}

/**
 * @param {LifecycleState} v
 * @returns {string}
 */
export function state(v) {
  return `${context(v)}: ${progress(v)}`;
}

export const regionNames = ["Project", "Hot reload"];

/** @type {Partial<Record<string, string>>} */
const STEPS = {
  BatchEnds: "the reload batch ends",
  ConfigEdit: "antelope.config.ts is edited",
  ConfigNoticed: "the watcher hashes the config",
  ConstructApply: "a module constructs",
  FlushStarts: "the debounce timer fires",
  LaunchAddModules: "the launch adds modules",
  LaunchConstruct: "the launch constructs modules",
  LaunchConstructed: "construction is done",
  LaunchHashConfig: "the watcher hashes the config",
  LaunchPrepare: "the launch reads antelope.config.ts",
  LaunchStart: "the launch starts modules",
  LaunchStarted: "modules have started",
  LaunchWatch: "the launch scans module files",
  LaunchWatching: "the watcher starts",
  ReloadBegins: "a reload takes a module",
  RestartLaunches: "the next launch begins",
  RestartRequested: "dev restarts for the edit",
  RlCallStart: "the reload starts the new generation",
  RlCleanup: "the reload destroys the failed generation",
  RlConstruct: "the new generation constructs",
  RlDestroyPrevious: "the old generation is destroyed",
  RlInstall: "the reload installs the new generation",
  RlManifestLoaded: "the new code is loaded",
  RlRecover: "the reload restarts the old generation",
  RlRecovered: "the old generation runs again",
  RlStarted: "the new generation runs",
  SdClear: "the shutdown drops every module",
  SdDestroy: "the shutdown destroys a module",
  SdExit: "the shutdown ends",
  SdRelease: "the shutdown releases signals",
  SdStop: "the shutdown stops a module",
  SdStopDone: "every module is stopped",
  SdTolerance: "the shutdown withdraws reload tolerance",
  SdWatcher: "the watcher stops",
  Sigint: "you press Ctrl+C",
  SourceEdit: "you edit a module file",
  StaleWorkFails: "a destroyed generation's leftover work fails",
  StartApply: "a module starts",
};
/**
 * @param {string} action
 * @returns {string}
 */
export function step(action) {
  return STEPS[action] ?? action;
}

/**
 * @param {LifecycleState} v
 * @param {unknown} facts
 * @param {string} invariant
 * @returns {string | null}
 */
export function cause(v, facts, invariant) {
  if (invariant === "ConfigEditsReachProject") {
    return v.staleRead
      ? "the restart re-read the config jiti had cached, not the edited file"
      : "the edit landed after the launch read the config and before the watcher started";
  }
  if (invariant === "LaunchReadsCurrentConfig") {
    if (v.sigint) {
      return "a restart began a launch while Ctrl+C was stopping the project, and it read the cached config";
    }
    return v.configOwner === "none"
      ? "the modules live in subfolders, so no destroy evicted the config jiti cached"
      : "the root module was not loaded, so no destroy evicted the config jiti cached";
  }
  if (invariant !== "NoOrphanGeneration") return null;
  const fromReload = orphans(v).some((g) =>
    Object.values(v.rl).some((r) => r.repl === g || r.prev === g),
  );
  return fromReload
    ? "a reload installed its new generation in a manager the shutdown had already passed"
    : "a module constructed after the shutdown had already destroyed and dropped it";
}
