// Spec 205: the checkouts the dashboard owns.
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

import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { GitRunner } from "./branch-status.ts";
import { configValue, resolveWorktreeLinks } from "./discover.ts";
import { writeAideConfig } from "./project-admin.ts";

/** Where the dashboard keeps its own clones when nothing says otherwise.
 *  Beside `aide-dashboard/`, not inside the projects root: a directory
 *  under the projects root would be DISCOVERED as a project. */
export const DEFAULT_DASHBOARD_CHECKOUT_ROOT = join(homedir(), "aide-dashboard-checkouts");

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

/** Clone `from`'s origin into `dest`, or say why not.
 *
 *  Its OWN runner, with minutes rather than the four seconds every other
 *  git call here gets. That figure is right for a question — "is this
 *  branch merged" — and a clone is not a question: the specs repository
 *  took 4.3 s to clone on 2026-08-23 and was killed at 4.0, leaving a
 *  `.git` holding `objects` and no `HEAD`. Every run then refused,
 *  because the checkout it needed was a directory that was not a
 *  repository. And the repository grows with every spec, so the margin
 *  only ever gets worse. */
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;
/** A fetch talks to origin, so it gets more than a question's four
 *  seconds too — less than a clone, which moves the whole history. */
const FETCH_TIMEOUT_MS = 60 * 1000;

async function cloneFrom(run: GitRunner, from: string, dest: string): Promise<string | null> {
  const origin = await run(from, ["remote", "get-url", "origin"]);
  const url = origin.code === 0 ? origin.stdout.trim() : "";
  if (!url) return `${from} has no origin remote, so the dashboard has nothing to clone its own checkout from`;
  mkdirSync(dirname(dest), { recursive: true });
  // `cwd` at the parent with the name as the destination argument, the
  // way `addProject` clones: the destination does not exist yet, so it
  // is the one git call that cannot run inside its own directory.
  const cloned = await run(dirname(dest), ["clone", url, basename(dest)], CLONE_TIMEOUT_MS);
  if (cloned.code !== 0) {
    const said = (cloned.stderr ?? "").trim() || (cloned.stdout ?? "").trim();
    return `cloning ${url} into ${dest} failed (exit ${cloned.code})${said ? `: ${said.slice(-200)}` : ""}`;
  }
  return null;
}

/** The path with every symlink followed, so two answers about the same
 *  directory can be compared and subtracted. `git rev-parse
 *  --show-toplevel` reports the real path — on a Mac `/var/folders/...`
 *  answers as `/private/var/folders/...` — and a `relative()` between
 *  the two spellings walks out of the tree entirely. */
const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

const topOf = async (run: GitRunner, dir: string): Promise<string | null> => {
  if (!existsSync(dir)) return null;
  const top = await run(dir, ["rev-parse", "--show-toplevel"]);
  return top.code === 0 && top.stdout.trim() ? real(top.stdout.trim()) : null;
};

/** Whether there is anything here claiming to be a checkout. The
 *  ordinary first use answers `false`, and it answers without a
 *  subprocess and without suspending — which the caller depends on:
 *  spec 208 counts the git commands a cold page render spawns, and an
 *  `await` reached on the nothing-is-there path moves the first clone's
 *  own git call out of boot and into the next request. */
const looksCloned = (dir: string): boolean => existsSync(join(dir, ".git"));

/** Whether a checkout is one a run can work in — present is not the
 *  same as finished. A clone killed part-way through leaves a `.git`
 *  holding `objects` and no `HEAD`, which `existsSync` reads as done
 *  and git reads as no repository at all (spec 209).
 *
 *  `topOf` asked TWICE before its `null` is believed, because this is
 *  the answer that decides whether the directory gets deleted. A run's
 *  worktree is cut from `code` with `git worktree add` and goes on
 *  reading `code/.git` for its whole duration, so a single flaky
 *  `rev-parse` must not turn a healthy, live checkout into a removed
 *  one. Two failures in a row is "git cannot answer this question",
 *  which is the same bar `aide-run-spec` accepts before it refuses. */
async function isUsable(run: GitRunner, dir: string): Promise<boolean> {
  if (await topOf(run, dir)) return true;
  return (await topOf(run, dir)) !== null;
}

/** The gitignored paths the project's own commands need, linked in from
 *  the person's checkout.
 *
 *  A worktree carries TRACKED files only, so `aide-run-spec` symlinks
 *  each `worktreeLinks` entry from the checkout it was pointed at — and
 *  a fresh clone has none of them, which would refuse every run for
 *  every project that configures any. Linked rather than rebuilt: one
 *  `.venv` is already shared by every concurrent run today, so this
 *  changes nothing about who shares what, and a symlink is not a git
 *  operation — it is not the kind of writing the person's checkout was
 *  taken out of the machinery to avoid.
 *
 *  Silent about failures on purpose: a link that cannot be made is a
 *  refusal the readiness check already reports by name, and this is not
 *  the place to turn it into a clone that failed. */
function linkWorktreePaths(personDir: string, code: string): void {
  const { links } = resolveWorktreeLinks(personDir);
  for (const entry of (links ?? "").split(/\s+/).filter(Boolean)) {
    const source = join(personDir, entry);
    const target = join(code, entry);
    if (!existsSync(source) || existsSync(target)) continue;
    try {
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(source, target);
    } catch {
      /* the readiness check says what is missing */
    }
  }
}

/** The dashboard's own checkout of `project`, made if it is not there.
 *
 *  Idempotent and cheap on every call after the first: it re-derives
 *  where the specs are and rewrites `AIDE_SPECS_PATH` when that answer
 *  has changed, which is how a specs root edited on the Settings page
 *  reaches the checkout the runner actually reads. */
/** Bring a checkout of the dashboard's own up to date with origin.
 *
 *  Made once and never touched again was the shape until 2026-08-23: a
 *  spec written in the person's checkout and pushed was listed by the
 *  page — which reads THEIR checkout — and refused by the runner, which
 *  reads this one. "unknown spec: 13-woodstack-26" on a spec the reader
 *  could see. It is not a clone that missed something; nobody asked it
 *  to fetch.
 *
 *  Fast-forward only, and a failure is not fatal: these checkouts stay
 *  on their default branch and nobody commits in them, so there is
 *  nothing here to lose — and an origin that cannot be reached should
 *  leave the run to work with what it has rather than refusing. */
async function bringUpToDate(run: GitRunner, dir: string): Promise<void> {
  const branch = await run(dir, ["symbolic-ref", "--short", "HEAD"]);
  const name = branch.code === 0 ? branch.stdout.trim() : "";
  if (!name) return;
  await run(dir, ["fetch", "--quiet", "origin", name], FETCH_TIMEOUT_MS);
  await run(dir, ["merge", "--ff-only", "--quiet", `origin/${name}`]);
}

export async function ensureDashboardCheckout(run: GitRunner, req: EnsureRequest): Promise<EnsureResult> {
  const code = dashboardCheckoutRoot(req.base, req.project);
  let cloned = false;
  if (!looksCloned(code) || !(await isUsable(run, code))) {
    // Whatever a killed clone left is in the way: `git clone` refuses a
    // non-empty directory. Nothing here is anyone's work — it is a
    // clone, and what it was a clone of is still on origin. A no-op
    // when there is nothing there yet.
    rmSync(code, { recursive: true, force: true });
    const failed = await cloneFrom(run, req.personDir, code);
    if (failed) return { ok: false, error: failed, cloned: false };
    cloned = true;
  } else {
    await bringUpToDate(run, code);
  }
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
  // `AIDE_SPECS_PATH` is the one key that must NOT survive the copy, and
  // it is rewritten below.
  const personConfig = join(req.personDir, ".aide", "config");
  if (existsSync(personConfig)) {
    mkdirSync(join(code, ".aide"), { recursive: true });
    copyFileSync(personConfig, join(code, ".aide", "config"));
  }
  linkWorktreePaths(req.personDir, code);

  const personSpecs = configValue(req.personDir, "AIDE_SPECS_PATH");
  let specs: string;
  let specsRepo: string;
  if (!personSpecs) {
    // No specs root configured: the runner falls back to `specs/` inside
    // the project, and so does its own clone.
    specsRepo = code;
    specs = join(code, "specs");
  } else {
    const personTop = await topOf(run, req.personDir);
    const specsTop = await topOf(run, personSpecs);
    if (!specsTop) {
      return { ok: false, error: `${personSpecs} is in no git repository, so there is nothing to clone`, cloned };
    }
    if (personTop && specsTop === personTop) {
      // The specs are in the project's own repository — one clone, and
      // the same relative path inside it.
      specsRepo = code;
      specs = join(code, relative(personTop, real(personSpecs)));
    } else {
      specsRepo = dashboardSpecsRepo(req.base, req.project);
      if (!looksCloned(specsRepo) || !(await isUsable(run, specsRepo))) {
        rmSync(specsRepo, { recursive: true, force: true });
        const failed = await cloneFrom(run, specsTop, specsRepo);
        if (failed) return { ok: false, error: failed, cloned };
        cloned = true;
      } else {
        await bringUpToDate(run, specsRepo);
      }
      // The specs ROOT is a folder inside the specs REPO — one
      // repository holds a folder per project, which is how this repo
      // itself is laid out. That step of the path is kept.
      specs = join(specsRepo, relative(specsTop, real(personSpecs)));
    }
  }
  // A run refuses "no specs root at …" before anything else, and a
  // project whose first spec has not been written yet has no such
  // folder in git to clone. Made with its `archive/`, the same thing Add
  // does for the person's.
  mkdirSync(join(specs, "archive"), { recursive: true });
  // Rewritten whenever the answer has moved, not only at creation: the
  // Settings page writes `AIDE_SPECS_PATH` into the person's config, and
  // the runner reads it out of this one.
  if (configValue(code, "AIDE_SPECS_PATH") !== specs) writeAideConfig(code, { AIDE_SPECS_PATH: specs });
  return { ok: true, cloned, checkout: { code, specs, specsRepo } };
}
