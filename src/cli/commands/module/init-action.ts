import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  type AnswerFlag,
  CliError,
  createPrompter,
  DEFAULT_PACKAGE_MANAGER,
  displayPath,
  getProcessPalette,
  getProcessUi,
  missingFlags,
  PACKAGE_MANAGER_NAMES,
  type PackageManagerName,
  type Prompter,
  runTask,
  Spinner,
  translateFailure,
  USAGE_EXIT_CODE,
} from "../../../core/output";
import { displayNonDefaultGitWarning, resolveGit } from "../../common";
import { createModule, type ModuleInitAnswers } from "./create-module";
import {
  findTemplate,
  type GitManifest,
  type InterfaceInfo,
  loadInterfacesFromGit,
  loadManifestFromGit,
  type Template,
  templateSlug,
} from "../../git-operations";
import { requireCatalogMember } from "../../catalog-manifest";

export interface ModuleInitOptions {
  git?: string;
  template?: string;
  interfaces?: string[];
  pm?: PackageManagerName;
  gitInit?: boolean;
  yes?: boolean;
}

export interface ModuleInitContext {
  isFromProject?: boolean;
  prompter?: Prompter;
}

type InterfaceCatalog = Record<string, InterfaceInfo>;

type TemplateCatalog = GitManifest & { templates: Template[] };

const TEMPLATE_OPTION = "--template";
const INTERFACES_OPTION = "--interfaces";
export const TEMPLATE_FLAG = `${TEMPLATE_OPTION} <slug>`;
export const PACKAGE_MANAGER_FLAG = `--pm <${PACKAGE_MANAGER_NAMES.join("|")}>`;
const INTERFACES_FLAG = `${INTERFACES_OPTION} <names>`;
export const YES_FLAG = "--yes";
export const GIT_INIT_FLAG = "--[no-]git-init";
const MODULE_INIT_COMMAND = "ajs module init";
const PROJECT_INIT_COMMAND = "ajs project init";
const CURRENT_DIRECTORY = ".";

const CHECK_REPOSITORY_FIX =
  "Check the URL passed with --git or saved with ajs config set git";
const RESET_REPOSITORY_FIX =
  "Or go back to the default repository: ajs config reset";

const MODULE_ANSWER_FLAGS: AnswerFlag<ModuleInitOptions>[] = [
  { option: "template", flag: TEMPLATE_FLAG },
  { option: "pm", flag: PACKAGE_MANAGER_FLAG },
  { option: "gitInit", flag: GIT_INIT_FLAG },
];

async function loadTemplates(git: string): Promise<TemplateCatalog> {
  try {
    const manifest = await loadManifestFromGit(git);
    return {
      ...manifest,
      templates: requireCatalogMember(manifest, "templates", git),
    };
  } catch (err) {
    const cause = translateFailure(err);
    throw new CliError(
      {
        title: `Could not fetch templates from ${git}`,
        reason: cause?.reason ?? cause?.title,
        fixes: [
          ...(cause?.fixes ?? [CHECK_REPOSITORY_FIX]),
          RESET_REPOSITORY_FIX,
        ],
      },
      { cause: err },
    );
  }
}

interface UnknownChoice {
  kind: string;
  flagName: string;
  names: string[];
  known: string[];
}

function quote(name: string): string {
  return `'${name}'`;
}

function unknownChoiceError(choice: UnknownChoice): CliError {
  const [example] = choice.known;
  return new CliError({
    title: `Unknown ${choice.kind} ${choice.names.map(quote).join(", ")}`,
    reason: `Available: ${choice.known.join(", ") || "none"}`,
    fixes: example
      ? [`Pass one of them, e.g. ${choice.flagName} ${quote(example)}`]
      : [],
    exitCode: USAGE_EXIT_CODE,
  });
}

function isDirectoryOccupied(modulePath: string): boolean {
  const target = path.resolve(modulePath);
  return existsSync(target) && readdirSync(target).length > 0;
}

async function ensureDirectoryUsable(
  modulePath: string,
  isFromProject: boolean,
): Promise<void> {
  const palette = getProcessPalette();
  const dirSpinner = new Spinner(
    `Checking directory ${palette.dim(modulePath)}`,
  );
  await dirSpinner.start();
  if (isDirectoryOccupied(modulePath)) {
    await dirSpinner.stop();
    const usage = isFromProject
      ? `${PROJECT_INIT_COMMAND} <project>`
      : `${MODULE_INIT_COMMAND} <path>`;
    throw new CliError({
      title: `Directory ${modulePath} is not empty`,
      fixes: [`Pass an empty or new directory: ${usage}`],
    });
  }
  await dirSpinner.succeed(`Directory is valid`);
}

async function askTemplate(
  prompter: Prompter,
  options: ModuleInitOptions,
  templates: Template[],
  isFromProject: boolean,
): Promise<Template> {
  const answer = await prompter.select({
    message: `Choose a template for your ${isFromProject ? "project" : "module"}`,
    flag: TEMPLATE_FLAG,
    answer: options.template,
    defaultAnswer: templates[0] && templateSlug(templates[0]),
    choices: templates.map((template) => ({
      value: templateSlug(template),
      label: template.name,
      hint: template.description,
    })),
  });
  const template = findTemplate(templates, answer);
  if (!template) {
    throw unknownChoiceError({
      kind: "template",
      flagName: TEMPLATE_OPTION,
      names: [answer],
      known: templates.map(templateSlug),
    });
  }
  return template;
}

async function loadInterfaceCatalog(
  git: string,
  manifest: GitManifest,
): Promise<InterfaceCatalog> {
  const interfaceSpinner = new Spinner("Loading available interfaces");
  await interfaceSpinner.start();
  const catalog = await loadInterfacesFromGit(
    git,
    requireCatalogMember(manifest, "starredInterfaces", git),
  );
  await interfaceSpinner.succeed(
    `Found ${Object.keys(catalog).length} available interfaces`,
  );
  return catalog;
}

async function askInterfaces(
  prompter: Prompter,
  options: ModuleInitOptions,
  catalog: InterfaceCatalog,
): Promise<InterfaceInfo[]> {
  const known = Object.keys(catalog);
  if (known.length === 0 && options.interfaces === undefined) {
    return [];
  }
  const names = await prompter.multiselect({
    message: "Select interfaces to install (optional)",
    flag: INTERFACES_FLAG,
    answer: options.interfaces,
    defaultAnswer: [],
    isOptional: true,
    choices: Object.entries(catalog).map(([name, entry]) => ({
      value: name,
      label: name,
      hint: entry.manifest.description,
    })),
  });
  const available = new Map(Object.entries(catalog));
  const unknown = names.filter((name) => !available.has(name));
  if (unknown.length > 0) {
    throw unknownChoiceError({
      kind: "interface",
      flagName: INTERFACES_OPTION,
      names: unknown,
      known,
    });
  }
  return names.flatMap((name) => available.get(name) ?? []);
}

function installsOnHost(template?: Template): boolean {
  return template?.install !== false;
}

function askPackageManager(
  prompter: Prompter,
  options: ModuleInitOptions,
  template: Template,
): Promise<PackageManagerName | undefined> {
  if (!installsOnHost(template)) {
    return Promise.resolve(undefined);
  }
  if (template.packageManager) {
    if (options.pm && options.pm !== template.packageManager) {
      throw new CliError({
        title: `Template '${template.name}' requires ${template.packageManager}`,
        fixes: [`Use --pm ${template.packageManager} or omit --pm`],
        exitCode: USAGE_EXIT_CODE,
      });
    }
    return Promise.resolve(template.packageManager);
  }
  return prompter.select<PackageManagerName>({
    message: "Which package manager would you like to use?",
    flag: PACKAGE_MANAGER_FLAG,
    answer: options.pm,
    defaultAnswer: DEFAULT_PACKAGE_MANAGER,
    choices: PACKAGE_MANAGER_NAMES.map((name) => ({
      value: name,
      label: name,
    })),
  });
}

function askGitInit(
  prompter: Prompter,
  options: ModuleInitOptions,
): Promise<boolean> {
  return prompter.confirm({
    message: "Initialize a git repository in the module?",
    flag: GIT_INIT_FLAG,
    answer: options.gitInit,
    defaultAnswer: true,
  });
}

function displayWizardWelcome(prompter: Prompter): void {
  if (!prompter.isInteractive) {
    return;
  }
  getProcessUi().message(
    "info",
    "Welcome to the AntelopeJS module creation wizard!",
    {
      detail: "Please select a template and provide the required information.",
    },
  );
}

async function askTemplateInterfaces(
  prompter: Prompter,
  options: ModuleInitOptions,
  git: string,
  manifest: GitManifest,
  template: Template,
): Promise<InterfaceInfo[]> {
  if (
    manifest.projectTemplates?.includes(template) &&
    options.interfaces === undefined
  ) {
    return [];
  }
  const catalog = await loadInterfaceCatalog(git, manifest);
  return askInterfaces(prompter, options, catalog);
}

async function askModuleAnswers(
  prompter: Prompter,
  options: ModuleInitOptions,
  git: string,
  manifest: TemplateCatalog,
  isFromProject: boolean,
): Promise<ModuleInitAnswers> {
  if (!isFromProject) {
    displayWizardWelcome(prompter);
  }
  const templates = [
    ...manifest.templates,
    ...(isFromProject ? (manifest.projectTemplates ?? []) : []),
  ];
  const selected = findTemplate(templates, options.template);
  prompter.requireAnswers(
    missingFlags(
      { ...options, pm: options.pm ?? selected?.packageManager },
      MODULE_ANSWER_FLAGS.filter(
        ({ option }) => option !== "pm" || installsOnHost(selected),
      ),
    ),
  );
  const template = await askTemplate(
    prompter,
    options,
    templates,
    isFromProject,
  );
  const interfaces = await askTemplateInterfaces(
    prompter,
    options,
    git,
    manifest,
    template,
  );
  const packageManager = await askPackageManager(prompter, options, template);
  const isGitInitialized = await askGitInit(prompter, options);
  return { template, interfaces, packageManager, isGitInitialized };
}

function displayModuleCreated(
  modulePath: string,
  answers: ModuleInitAnswers,
  context: ModuleInitContext,
): void {
  if (context.isFromProject) {
    return;
  }
  const template = getProcessPalette().bold(answers.template.name);
  getProcessUi().summary({
    headline: `Created module from template ${template}`,
    artifact: displayPath(path.resolve(modulePath)),
    nextSteps: answers.template.nextSteps && [
      ...(modulePath === CURRENT_DIRECTORY
        ? []
        : [{ command: `cd ${displayPath(path.resolve(modulePath))}` }]),
      ...answers.template.nextSteps,
    ],
  });
}

function modulePrompter(
  modulePath: string,
  options: ModuleInitOptions,
  context: ModuleInitContext,
): Prompter {
  return (
    context.prompter ??
    createPrompter({
      command: `${MODULE_INIT_COMMAND} ${modulePath}`,
      acceptsDefaults: options.yes,
      defaultsFlag: YES_FLAG,
    })
  );
}

/**
 * Creates a module from a template. An empty path names the current
 * directory, as `path.resolve` reads it. The directory and the template
 * repository are checked first, so their errors come before any missing
 * answer. Every question is answered before anything is written, so a
 * cancelled or unanswerable question leaves the target directory untouched.
 */
export async function moduleInitCommand(
  requestedPath: string,
  options: ModuleInitOptions,
  context: ModuleInitContext = {},
) {
  const modulePath = requestedPath === "" ? CURRENT_DIRECTORY : requestedPath;
  const prompter = modulePrompter(modulePath, options, context);
  await ensureDirectoryUsable(modulePath, Boolean(context.isFromProject));
  const git = await resolveGit(options);
  displayNonDefaultGitWarning(git);
  const manifest = await runTask(
    "Loading templates",
    () => loadTemplates(git),
    {
      done: (loaded) =>
        `Found ${loaded.templates.length + (context.isFromProject ? (loaded.projectTemplates?.length ?? 0) : 0)} templates`,
    },
  );
  const answers = await askModuleAnswers(
    prompter,
    options,
    git,
    manifest,
    Boolean(context.isFromProject),
  );
  await createModule(modulePath, answers);
  displayModuleCreated(modulePath, answers, context);
  return answers.template;
}

export function runModuleInit(modulePath: string, options: ModuleInitOptions) {
  return moduleInitCommand(modulePath, options);
}
