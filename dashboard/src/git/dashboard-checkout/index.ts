// The checkouts the dashboard owns.
//
// A run works in a worktree of its own, but that worktree was cut from
// the checkout a person edits — `<projectsRoot>/<project>`, the one Add
// clones into and the one somebody `cd`s to. The runner puts every root
// it touches onto its default branch before it starts, and a landing
// merges and pushes from the same directory. On 2026-08-23 three specs
// were archived with their code stranded on a branch, because edits made
// in that checkout met what two runs were landing from it. `mergeLock`
// serializes the dashboard against ITSELF; nothing serializes it against
// a person's own git client, and nothing can.
//
// So the machinery gets clones nobody else touches, under
// `<base>/<project>/{code,specs}`, made the first time they are needed
// and reused for ever after. The person's checkout stays exactly where
// it was and is never written to again — the dashboard reads it for
// display, and reads two things out of it here: which origin to clone
// from, and the personal `.aide/config` a clone can never bring along.
//
// Three properties are the whole of it, and each has a test:
//
//  - ONE checkout per project, not one per run. That is the disk cost
//    the description asks for and accepts.
//  - `AIDE_SPECS_PATH` in the dashboard's own config names the
//    dashboard's own specs. A copied config would send `aide-run-spec`
//    straight back into the person's specs checkout, which is the
//    collision with an extra step.
//  - Nothing here runs a git command in the person's directory except
//    the two read-only questions above.

import { realPathOrAbsolute as real } from "../real-path.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { GitRunner } from "../process/index.ts";
import { carryManifest, excludeDerivedManifest } from "../checkout-manifest.ts";
import { askTop } from "../checkout-usable/index.ts";
import { configValue } from "../../project/discover";
import { writeAideConfig } from "../../project/aide-config.ts";
import { bringUpToDate, linkWorktreePaths, notKnown, prepareClone } from "./prepare.ts";

/** Where the dashboard keeps its own clones when nothing says otherwise.
 *  Beside `aide-dashboard/`, not inside the projects root: a directory
 *  under the projects root would be DISCOVERED as a project. */
export const DEFAULT_DASHBOARD_CHECKOUT_ROOT = join(homedir(), ".aide", "dashboard", "checkouts");

/** The projects root that holds links to these checkouts rather than
 *  checkouts of its own: `projects/` beside `checkouts/`. A server whose
 *  `--root` is this directory clones a new project straight into its
 *  own checkout and links it here (`addProject`). */
export function dashboardProjectsRoot(base: string): string {
  return join(dirname(base), "projects");
}

/** The two roots a project's machinery works in. `specsRepo` is the
 *  repository `specs` sits in — the same one when the specs live in the
 *  project's own repo, a clone of its own when they do not. */
export interface DashboardCheckout {
  code: string;
  specs: string;
  specsRepo: string;
}

export interface EnsureRequest {
  base: string;
  project: string;
  /** The checkout a person edits: where `origin` and the personal
   *  `.aide/config` are read from, and nothing else. */
  personDir: string;
  /** Whether this call may CLONE what is missing. False — the default,
   *  and what every tick, boot and page render passes — reports instead.
   *
   *  A clone belongs to a press: Add makes a project's checkout, and
   *  saving a specs root makes the clone of the repository it names.
   *  Between those, a checkout that is not there is something to look
   *  at: the dashboard used to clone one whenever it noticed the
   *  absence, which is how it came to delete woodstack's and try to
   *  clone it back from itself (2026-09-21). */
  mayClone?: boolean;
  /** Paces the polls for a checkout's lock; a test passes one that
   *  returns at once. */
  wait?: (ms: number) => Promise<void>;
}

export interface EnsureResult {
  ok: boolean;
  checkout?: DashboardCheckout;
  /** Why not, in words a readiness check can put on the page. A run
   *  refused with nobody there is what this exists to avoid. */
  error?: string;
  /** Whether THIS call did the cloning. The second call for a project
   *  answers `false`, which is what "reused, not re-cloned" means. */
  cloned: boolean;
  /** Not made yet, and the project is readable without it: every caller
   *  falls back to the checkout it used before this one, so this is a
   *  state the board works in rather than one to be looked at. It is
   *  what keeps the banner (`render/ui/checkout-faults.ts`) for the
   *  checkouts that ARE there and cannot be used. */
  absent?: boolean;
  /** A check git did not finish: nothing is known, and nothing was done
   *  because of it. The warning it leaves is checked again soon. */
  inconclusive?: boolean;
  /** The failed check and what came back, git's own words included —
   *  for the log, not the page. */
  detail?: string;
}

/** Pure path resolution, so every reader that only needs to KNOW the
 *  path — the drift poll's key, the origin check's root — can ask
 *  without awaiting a clone. */
export function dashboardCheckoutRoot(base: string, project: string): string {
  return join(base, project, "code");
}

/** Where a SEPARATE specs repository is cloned. Absent on disk is the
 *  answer to "are the specs in the project's own repo": there is no
 *  second clone when they are. */
export function dashboardSpecsRepo(base: string, project: string): string {
  return join(base, project, "specs");
}

/** The settings the dashboard keeps for a project whose own manifest is
 *  not tracked: beside the checkouts, in the manifest's own format, and
 *  never inside any repository. */
export function dashboardSettingsFile(base: string, project: string): string {
  return join(base, project, "settings.yaml");
}

/** The dashboard's own copy of a spec folder the display found in the
 *  person's checkout — what Save and Update write in.
 *
 *  `null` for a folder that is not under the person's specs root at
 *  all: that names nothing the dashboard owns a copy of, and guessing
 *  one would commit into a directory nobody asked about. */
export function dashboardSpecDir(
  checkout: DashboardCheckout,
  personSpecsRoot: string,
  personSpecDir: string,
): string | null {
  const rel = relative(resolve(personSpecsRoot), resolve(personSpecDir));
  if (rel.startsWith("..")) return null;
  return rel ? join(checkout.specs, rel) : checkout.specs;
}

/** The dashboard's own checkout of `project`, made if it is not there.
 *
 *  Idempotent and cheap on every call after the first: it re-derives
 *  where the specs are and rewrites `AIDE_SPECS_PATH` when that answer
 *  has changed, which is how a specs root edited on the Settings page
 *  reaches the checkout the runner actually reads. */
export async function ensureDashboardCheckout(run: GitRunner, req: EnsureRequest): Promise<EnsureResult> {
  const code = dashboardCheckoutRoot(req.base, req.project);
  const target = { dir: code, label: "checkout", ownTop: req.personDir, personEntry: req.personDir };
  const prepared = await prepareClone(run, target, req.mayClone ?? false, false);
  if (typeof prepared !== "string") return prepared;
  await excludeDerivedManifest(run, code);
  if (prepared === "usable") await bringUpToDate(run, code, req.wait);
  // `.aide/config` is gitignored, so `git clone` never carries it —
  // without this the dashboard's own checkout would have no
  // `AIDE_INSTALL_CMD` and no `AIDE_TEST_CMD` at all, which is unusable
  // rather than merely incomplete.
  //
  // Re-copied on every call, not only at creation: it is the file an
  // operator edits by hand between merges, and a copy taken once would
  // go on answering with whatever was true the day the clone was made —
  // silently, which is the whole hazard of keeping two of one file.
  // Nobody edits the copy, so there is nothing here to lose.
  // `AIDE_SPECS_PATH` is the one key that must NOT survive the copy: it
  // is replaced with the dashboard's own specs checkout, worked out
  // below — and the file is written ONCE, finished, at the end
  // (`writeCheckoutConfig`). It used to be copied here and rewritten
  // after the specs repo's clone/fetch, and an `aide-run-spec` starting
  // for another job in that window read the person's specs path out of
  // it and ran archive against the wrong checkout (2026-09-03).
  const personConfig = join(req.personDir, ".aide", "config");
  const personConfigText = existsSync(personConfig) ? readFileSync(personConfig, "utf-8") : null;
  await carryManifest(run, { code, personDir: req.personDir, settingsFile: dashboardSettingsFile(req.base, req.project) });
  linkWorktreePaths(req.personDir, code);

  const located = await locateSpecs(run, req, code, prepared === "cloned");
  if ("ok" in located) return located;
  const { specs, specsRepo, cloned } = located;
  // A run refuses "no specs root at …" before anything else, and a
  // project whose first spec has not been written yet has no such
  // folder in git to clone. Made with its `archive/`, the same thing Add
  // does for the person's.
  mkdirSync(join(specs, "archive"), { recursive: true });
  // Written whole on every call: the Settings page writes into the
  // person's config, and the runner reads out of this one.
  writeCheckoutConfig(code, personConfigText, specs, { project: req.project, specsRepo });
  return { ok: true, cloned, checkout: { code, specs, specsRepo } };
}

/** Where the dashboard's own specs root is, and whether finding it
 *  cloned anything — or the answer to give when it cannot be had. */
async function locateSpecs(
  run: GitRunner,
  req: EnsureRequest,
  code: string,
  cloned: boolean,
): Promise<{ specs: string; specsRepo: string; cloned: boolean } | EnsureResult> {
  const personSpecs = configValue(req.personDir, "AIDE_SPECS_PATH");
  // No specs root configured: the runner falls back to `specs/` inside
  // the project, and so does its own clone.
  if (!personSpecs) return { specsRepo: code, specs: join(code, "specs"), cloned };
  const person = await askTop(run, req.personDir);
  const asked = await askTop(run, personSpecs);
  // Before either answer is read: a `null` from a check that did not
  // finish would say "in no git repository", or send a press to clone a
  // separate specs repository the project does not have.
  for (const a of [person, asked]) if (a.top === null && !a.finished) return notKnown(a.detail, cloned);
  if (asked.top === null) {
    return { ok: false, error: `${personSpecs} is in no git repository, so there is nothing to clone`, detail: asked.detail, cloned };
  }
  const personTop = person.top;
  const specsTop = asked.top;
  if (personTop && specsTop === personTop) {
    // The specs are in the project's own repository — one clone, and
    // the same relative path inside it.
    return { specsRepo: code, specs: join(code, relative(personTop, real(personSpecs))), cloned };
  }
  const specsRepo = dashboardSpecsRepo(req.base, req.project);
  // The same answers the code checkout gives, for the same reasons.
  const target = { dir: specsRepo, label: "specs checkout", ownTop: specsTop, personEntry: personSpecs };
  const prepared = await prepareClone(run, target, req.mayClone ?? false, cloned);
  if (typeof prepared !== "string") return prepared;
  if (prepared === "usable") await bringUpToDate(run, specsRepo, req.wait);
  // The specs ROOT is a folder inside the specs REPO — one
  // repository holds a folder per project, which is how this repo
  // itself is laid out. That step of the path is kept.
  return { specsRepo, specs: join(specsRepo, relative(specsTop, real(personSpecs))), cloned: cloned || prepared === "cloned" };
}

/** The checkout's `.aide/config`: the person's file with
 *  `AIDE_SPECS_PATH` replaced by the dashboard's own specs checkout,
 *  built in a temporary file beside it and swapped in with one
 *  `rename`, so no reader ever sees a copy that still names the
 *  person's path.
 *
 *  Two things are said in the log, because this one line decides where a
 *  run makes a spec folder and nothing used to say anything about it at
 *  all (2026-09-21: a spec created at the specs repository's root, a
 *  landing looking for it under the project's own directory, and no
 *  record of how the root got there).
 *
 *  A CHANGED value is said with both sides of it. And a value naming the
 *  specs REPOSITORY's own root, while that repository holds a directory
 *  named after this project, is said every time: it is what the incident
 *  looked like, and the value reproduces itself — the root is derived
 *  from the root — so "it changed" would never catch it. Said, not
 *  corrected: a specs repository with one project in it legitimately
 *  keeps its specs at the root, and the board cannot tell the two apart. */
function writeCheckoutConfig(
  code: string,
  personConfigText: string | null,
  specs: string,
  says: { project: string; specsRepo: string },
): void {
  const dir = join(code, ".aide");
  const file = join(dir, "config");
  const before = configValue(code, "AIDE_SPECS_PATH");
  if (before !== null && before !== specs) {
    console.error(`queue: the specs path in ${file} changes: ${before} -> ${specs}`);
  }
  if (real(specs) === real(says.specsRepo) && existsSync(join(says.specsRepo, says.project))) {
    console.error(
      `queue: the specs path in ${file} names the specs repository's own root (${specs}), ` +
        `and that repository also holds ${join(says.specsRepo, says.project)} — ` +
        `specs for ${says.project} will be made at the root`,
    );
  }
  writeAideConfig(code, { AIDE_SPECS_PATH: specs }, personConfigText ?? "");
}
