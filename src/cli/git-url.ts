import path from "node:path";

const GIT_URL_PATTERNS = [
  /^(?:https?|ssh|git):\/\/[^\s/]+(?:\/\S*)?$/,
  /^file:\/\/\S+$/,
  /^[\w.-]+@[\w.-]+:\S+$/,
];

/**
 * Whether `value` is something `git clone` reads as a repository: an
 * `https`, `ssh`, `git` or `file` URL, an scp-like address such as
 * `git@github.com:acme/interfaces.git`, or an absolute local path.
 */
export function isGitRepositoryUrl(value: string): boolean {
  return (
    GIT_URL_PATTERNS.some((pattern) => pattern.test(value)) ||
    path.isAbsolute(value)
  );
}
