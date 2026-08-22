// The seven `.aide/config` keys a project's page shows, each with
// where its value came from (spec 185).
//
// The file is personal and gitignored, so the answer differs per
// machine — and until this, the only way to see it was to open it in a
// terminal on the serving host. A page that shows only what the file
// SAYS would still be half an answer: a test command is usually worked
// out from the project's own lockfile rather than configured, so what
// the file leaves out is not the same as what a run would do.
//
// Three states, and the third is the one the description cares most
// about:
//
//   configured — the file names it
//   derived    — the file does not, and a run would work it out
//   unset      — neither, and that is what stops a run
//
// One rule this module holds to strictly: whether a configured PATH
// resolves is not decided here. `assessProjectReadiness` in
// `project-admin.ts` already decides it, in the words the reader is
// shown, and `.claude/rules/development.md` names a second,
// hand-synchronised copy of that decision as a mistake this repo has
// already paid for twice (specs 138 and 144). So the row's problem is
// read verbatim off a readiness result handed in from outside.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { configValue } from "./discover.ts";
import { detectProjectCommands, type CommandKind } from "./detect-commands.ts";
import type { ProjectReadiness, ReadinessCheckName } from "./project-admin.ts";

export type SettingOrigin = "configured" | "derived" | "unset";

export interface SettingRow {
  key: string;
  /** What the key is FOR, in one line — the purposes from
   *  `core/skills/tools-and-scripts/SKILL.md`. A page listing seven
   *  screaming-snake-case names and nothing else says what is set
   *  without saying what any of it does. */
  purpose: string;
  /** What a run would use, or `null` when nothing would. */
  value: string | null;
  origin: SettingOrigin;
  /** For a derived value: the file in the project root that decided
   *  it. Absent on every other origin — nothing was worked out. */
  source?: string;
  /** For a derived value: what that file says the project is built
   *  with. The page names it, because the risk a worked-out command
   *  carries is precisely that it is the DEFAULT for a toolchain
   *  rather than a command anyone ran. */
  toolchain?: string;
  /** Set only where a CONFIGURED value does not resolve, and always
   *  the readiness check's own sentence, never a second wording of the
   *  same fact. */
  problem?: string;
}

export interface ProjectSettingsView {
  /** Whether `.aide/config` is there at all. A project cloned onto a
   *  second machine has none, and "no file" and "a file that sets
   *  nothing" are different things a reader has to be able to tell
   *  apart. */
  hasConfigFile: boolean;
  rows: SettingRow[];
}

/** The keys, in the order the page lists them: where the specs are and
 *  what a worktree needs first, because those are what refuse a run;
 *  then what a run would execute; then the two that only matter once it
 *  has finished. Taken from
 *  `core/skills/tools-and-scripts/SKILL.md`'s own table plus its
 *  `AIDE_SPECS_PATH` paragraph. */
export const SETTING_KEYS = [
  "AIDE_SPECS_PATH",
  "AIDE_WORKTREE_LINKS",
  "AIDE_TEST_CMD",
  "AIDE_LINT_CMD",
  "AIDE_BUILD_CMD",
  "AIDE_INSTALL_CMD",
  "AIDE_JIRA_BASE_URL",
] as const;

const PURPOSE: Record<string, string> = {
  AIDE_SPECS_PATH: "where this project's specs are kept — its own specs/ when unset",
  AIDE_WORKTREE_LINKS: "gitignored paths a run's worktree needs, which git does not carry",
  AIDE_TEST_CMD: "the project's own test command",
  AIDE_LINT_CMD: "the project's own lint command",
  AIDE_BUILD_CMD: "the project's own build command",
  AIDE_INSTALL_CMD: "what installing this project means on this machine, run after its code merges",
  AIDE_JIRA_BASE_URL: "the JIRA root that turns an issue key into a link",
};

/** The three keys a lockfile can answer, and which command each is. */
const DERIVABLE: Record<string, CommandKind> = {
  AIDE_TEST_CMD: "test",
  AIDE_LINT_CMD: "lint",
  AIDE_BUILD_CMD: "build",
};

/** Which readiness check speaks for a key. Only the two path-like keys
 *  have one: the rest are values a run passes to a shell, and nothing
 *  read-only can say whether they work. */
const RESOLVED_BY: Record<string, ReadinessCheckName> = {
  AIDE_SPECS_PATH: "specsRoot",
  AIDE_WORKTREE_LINKS: "worktreeLinks",
};

/** One row per recognized key, for `projectDir`.
 *
 *  `readiness` is optional and may be `null` — that is what a git which
 *  cannot answer leaves behind, and a page missing its readiness
 *  section is a better answer than a page claiming a path is missing on
 *  no evidence. */
export function projectSettings(
  projectDir: string,
  readiness: ProjectReadiness | null = null,
): ProjectSettingsView {
  const detected = detectProjectCommands(projectDir);
  const rows = SETTING_KEYS.map((key): SettingRow => {
    const purpose = PURPOSE[key]!;
    const configured = configValue(projectDir, key);
    if (configured !== null) {
      const check = RESOLVED_BY[key];
      // Read verbatim, and only from a check that FAILED: the
      // worktree-links check reports the unset case too, and "no links
      // are configured" is not a value that failed to resolve.
      const failed = check ? readiness?.checks.find((c) => c.check === check && !c.ok) : undefined;
      return { key, purpose, value: configured, origin: "configured", ...(failed ? { problem: failed.detail } : {}) };
    }
    const kind = DERIVABLE[key];
    const found = kind ? detected[kind] : undefined;
    if (found) {
      return {
        key,
        purpose,
        value: found.cmd,
        origin: "derived",
        source: found.source,
        toolchain: found.toolchain,
      };
    }
    return { key, purpose, value: null, origin: "unset" };
  });
  return { hasConfigFile: existsSync(join(projectDir, ".aide", "config")), rows };
}
