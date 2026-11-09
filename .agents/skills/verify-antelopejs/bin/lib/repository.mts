import path from "node:path";

import { exitIs, has } from "./checks.mts";
import type { JourneyContext } from "./journey.mts";

const USER_COMMIT = "user commit";
const GIT_IDENTITY = ["-c", "user.name=verify", "-c", "user.email=verify@example.invalid", "-c", "commit.gpgsign=false"];

/** Makes `folder` a git repository with one commit of a user file, the way an existing repository looks. */
export async function makeUserRepository(context: JourneyContext, folder: string): Promise<void> {
  context.edit("put a user file in the repository", path.join(folder, "mine.txt"), "user data\n");
  const steps: [string, string[]][] = [
    ["git init", ["init", "-q"]],
    ["git add", ["add", "mine.txt"]],
    ["git commit", [...GIT_IDENTITY, "commit", "-qm", USER_COMMIT]],
  ];
  for (const [name, args] of steps) {
    const step = await context.command(name, "git", args, { cwd: folder });
    context.expect(step.folder, [exitIs(step, 0)], { critical: true });
  }
}

/** Reads the repository's history back with `git log` and checks the user commit is still there. */
export async function expectUserCommit(context: JourneyContext, folder: string): Promise<void> {
  const log = await context.command("git log after init", "git", ["log", "--format=%s"], { cwd: folder });
  context.expect(log.folder, [exitIs(log, 0), has("stdout", log.stdout, new RegExp(`^${USER_COMMIT}$`, "m"))]);
}
