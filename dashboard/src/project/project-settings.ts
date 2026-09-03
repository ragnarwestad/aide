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
import { configValue, resolveWorktreeLinks, resolveInstallCmd, resolveTestCmd } from "./discover.ts";
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
   *  it. For the Worktree links row's `"configured"` origin: which of
   *  the two files the value came from (`resolveWorktreeLinks()`'s own
   *  `source`) — the row can be configured in either, and a reader
   *  cannot tell which without this. Absent on every other origin. */
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

/** The three keys a lockfile can answer, and which command each is.
 *  Exported so `render/site.ts` can gate a row's edit-mode input on KEY
 *  membership here, rather than on the row's current `origin` — a key
 *  that is momentarily `unset` (no lockfile found yet) must stay
 *  read-only exactly as a `derived` one does, and a second,
 *  hand-duplicated list of these three names would drift from this one
 *  the moment a fourth derivable key is added. */
export const DERIVABLE: Record<string, CommandKind> = {
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

/** What `key`'s file(s) say is configured, and — for the one key with
 *  two possible files — which one answered. `null` when nothing is
 *  configured, exactly as `configValue()` alone used to answer for
 *  every key including this one, before the Worktree links row started
 *  reading `resolveWorktreeLinks()` instead: raw `configValue()` skips
 *  the manifest's `worktreeLinks:` entirely, so on a project where both
 *  files name a value the row could show one a run would never use
 *  (spec 255). */
function configuredValue(projectDir: string, key: string): { value: string; source?: string } | null {
  if (key === "AIDE_WORKTREE_LINKS") {
    const { links, source } = resolveWorktreeLinks(projectDir);
    return links ? { value: links, source: source ?? undefined } : null;
  }
  if (key === "AIDE_INSTALL_CMD" || key === "AIDE_TEST_CMD") {
    const { value, source } = (key === "AIDE_INSTALL_CMD" ? resolveInstallCmd : resolveTestCmd)(projectDir);
    return value ? { value, source: source ?? undefined } : null;
  }
  const value = configValue(projectDir, key);
  return value !== null ? { value } : null;
}

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
    const configured = configuredValue(projectDir, key);
    if (configured !== null) {
      const check = RESOLVED_BY[key];
      // Read verbatim, and only from a check that FAILED: the
      // worktree-links check reports the unset case too, and "no links
      // are configured" is not a value that failed to resolve.
      const failed = check ? readiness?.checks.find((c) => c.check === check && !c.ok) : undefined;
      return {
        key,
        purpose,
        value: configured.value,
        origin: "configured",
        ...(configured.source ? { source: configured.source } : {}),
        ...(failed ? { problem: failed.detail } : {}),
      };
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
