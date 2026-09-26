// The five `.aide/config` keys a project's page shows, each with
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
import { configValue, resolveWorktreeLinks, resolveInstallCmd, resolvePreviewCmd, resolveTestCmd } from "./discover";
import { detectProjectCommands, type CommandKind } from "./detect-commands.ts";
import type { ProjectReadiness, ReadinessCheckName } from "./project-admin";

export type SettingOrigin = "configured" | "derived" | "unset";

export interface SettingRow {
  key: string;
  /** What the key is FOR, in one line — the purposes from
   *  `core/skills/tools-and-scripts/SKILL.md`. A page listing five
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
  /** Set where a CONFIGURED or an UNSET value does not resolve, and
   *  always the readiness check's own sentence, never a second wording
   *  of the same fact. `blocking` is the same check's own flag (spec
   *  372): `unifiedSettingsTable` reads it to choose `failed`/`waiting`
   *  for this row, and the checkout-level section above the table reads
   *  it the same way for a check no row owns — the same fact must not
   *  read red in one place and amber in the other. */
  problem?: { text: string; blocking: boolean };
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
  "AIDE_INSTALL_CMD",
  "AIDE_PREVIEW_CMD",
] as const;

const PURPOSE: Record<string, string> = {
  AIDE_SPECS_PATH: "where this project's specs are kept — its own specs/ when unset",
  AIDE_WORKTREE_LINKS: "gitignored paths a run's worktree needs, which git does not carry",
  AIDE_TEST_CMD: "the project's own test command",
  AIDE_INSTALL_CMD: "what installing this project means on this machine, run after its code merges",
  AIDE_PREVIEW_CMD: "how to start this project so a spec's branch can be looked at, serving on $PORT",
};

/** The keys a lockfile can answer, and which command each is: the test
 *  command alone. The page shows no lint or build row, since nothing a
 *  run does reads them. */
export const DERIVABLE: Record<string, CommandKind> = {
  AIDE_TEST_CMD: "test",
};

/** Which readiness check speaks for a key. Only the two path-like keys
 *  have one: the rest are values a run passes to a shell, and nothing
 *  read-only can say whether they work. */
const RESOLVED_BY: Record<string, ReadinessCheckName> = {
  AIDE_SPECS_PATH: "specsRoot",
  AIDE_WORKTREE_LINKS: "worktreeLinks",
};

/** The checks a settings row already speaks for (spec 378) — exported so
 *  `project-page.ts` can filter its checkout-level section by the SAME
 *  set `RESOLVED_BY` names, rather than a second, hand-copied list. */
export const FIELD_OWNED_CHECKS: ReadonlySet<ReadinessCheckName> = new Set(Object.values(RESOLVED_BY));

/** What `key`'s file(s) say is configured, and — for the one key with
 *  two possible files — which one answered. `null` when nothing is
 *  configured, exactly as `configValue()` alone used to answer for
 *  every key including this one, before the Worktree links row started
 *  reading `resolveWorktreeLinks()` instead: raw `configValue()` skips
 *  the manifest's `worktreeLinks:` entirely, so on a project where both
 *  files name a value the row could show one a run would never use
 *  (spec 255). */
function configuredValue(
  projectDir: string,
  key: string,
  manifestDir: string,
): { value: string; source?: string } | null {
  if (key === "AIDE_WORKTREE_LINKS") {
    const { links, source } = resolveWorktreeLinks(manifestDir);
    return links ? { value: links, source: source ?? undefined } : null;
  }
  if (key === "AIDE_INSTALL_CMD" || key === "AIDE_TEST_CMD" || key === "AIDE_PREVIEW_CMD") {
    const resolve =
      key === "AIDE_INSTALL_CMD" ? resolveInstallCmd : key === "AIDE_TEST_CMD" ? resolveTestCmd : resolvePreviewCmd;
    const { value, source } = resolve(manifestDir);
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
  /** Where the manifest-backed rows are read from (spec 512): the
   *  dashboard's own checkout, which carries the manifest a run reads.
   *  The specs path and the config-file flag stay on `projectDir`. */
  manifestDir: string = projectDir,
): ProjectSettingsView {
  const detected = detectProjectCommands(manifestDir);
  const rows = SETTING_KEYS.map((key): SettingRow => {
    const purpose = PURPOSE[key]!;
    const configured = configuredValue(projectDir, key, manifestDir);
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
        ...(failed ? { problem: { text: failed.detail, blocking: failed.blocking } } : {}),
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
    // Spec 378 (REQ-2): the same `problem` lookup the `configured`
    // branch above makes — an UNSET field-owned check can still be
    // `blocking` (no specs root, and the fallback does not exist
    // either) or worth a note (no worktree links configured at all),
    // and before this it was visible only on the Health tab. Read
    // verbatim, same as the `configured` branch.
    const check = RESOLVED_BY[key];
    const unresolved = check ? readiness?.checks.find((c) => c.check === check && !c.ok) : undefined;
    return {
      key,
      purpose,
      value: null,
      origin: "unset",
      ...(unresolved ? { problem: { text: unresolved.detail, blocking: unresolved.blocking } } : {}),
    };
  });
  return { hasConfigFile: existsSync(join(projectDir, ".aide", "config")), rows };
}
