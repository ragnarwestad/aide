// Making one of the dashboard's own clones usable: checking the one that
// is there, refusing the ones that cannot be used, cloning the one that
// is missing when a press allows it, and bringing a usable one up to date.

import { realPathOrAbsolute as real } from "../real-path.ts";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { GitRunner } from "../process/index.ts";
import { CATCH_UP_LOCK_WAIT_MS, withCheckoutLock } from "../checkout-lock/index.ts";
import { checkUsable, looksCloned, notCheckedYet, type Usable } from "../checkout-usable/index.ts";
import { resolveWorktreeLinks } from "../../project/discover";
import type { EnsureRequest, EnsureResult } from "./index.ts";

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

/** What a check git did not finish answers: not known, and nothing done. */
export const notKnown = (detail: string, cloned: boolean): EnsureResult => ({
  ok: false, inconclusive: true, error: notCheckedYet(detail), detail, cloned,
});

/** The url a checkout would be cloned back from, asked of the checkout
 *  itself — which is why it is asked BEFORE anything is deleted. The
 *  answer lives in `.git/config`, so a delete that runs first takes the
 *  only copy of it with it. */
async function originUrlOf(run: GitRunner, dir: string): Promise<string | null> {
  const origin = await run(dir, ["remote", "get-url", "origin"]);
  const url = origin.code === 0 ? origin.stdout.trim() : "";
  return url || null;
}

async function cloneFrom(run: GitRunner, url: string, dest: string): Promise<string | null> {
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

/** One of the dashboard's own clones, and where it comes from. */
export interface CloneTarget {
  /** The clone itself. */
  dir: string;
  /** What the sentences call it: "checkout" or "specs checkout". */
  label: string;
  /** The person's own repository top — the clone when the projects root
   *  links to the dashboard's own checkouts. */
  ownTop: string;
  /** The person's entry: when it is gone too, the clone's absence is not
   *  a state the board works in. */
  personEntry: string;
}

/** The three refusals for a clone that is not usable and not merely
 *  unchecked, or `null` when it is missing and a press may clone it. */
function refusalFor(t: CloneTarget, verdict: Usable | null, mayClone: boolean, cloned: boolean): EnsureResult | null {
  const why = verdict ? "git rev-parse --show-toplevel fails in it" : "it has no .git";
  const detail = verdict && !verdict.usable ? verdict.detail : undefined;
  // On a host whose projects root is the dashboard's own directory of
  // links, the person's checkout IS this one — `cloneDestination`
  // (`project-admin/add-project.ts`) clones into
  // `checkouts/<project>/code` and links the projects root to it, one
  // copy read and written by the same server. Said first and in its
  // own words, because the answer below ("remove it by hand") would be
  // advice to delete the project. For the specs clone this is not
  // hypothetical: `AIDE_SPECS_PATH` is REWRITTEN to name that very clone,
  // so the specs root handed in on the next call is the clone itself.
  if (real(t.ownTop) === real(t.dir)) {
    return {
      ok: false,
      error: `${t.dir} is the project's own ${t.label}, not a copy of one, and ${why}, so the dashboard will not touch it — look at what git says about it`,
      detail,
      cloned,
    };
  }
  // A directory that is here but cannot answer is reported, never
  // repaired. It used to be deleted and cloned again, on the
  // assumption that a checkout of the dashboard's own is never anyone's
  // work — and on 2026-09-21 that delete removed a project. A clone
  // that cannot say what it is, is a thing to look at: nothing here
  // knows whether it holds work, and a re-clone decided by the board
  // is a repair nobody asked for.
  if (existsSync(t.dir)) {
    return {
      ok: false,
      error: `${t.dir} is not a checkout git can answer for (${why}) — the dashboard clones only into a directory that is not there, so remove it by hand once you have seen what is in it`,
      detail,
      cloned,
    };
  }
  if (mayClone) return null;
  return {
    ok: false,
    error: `${t.dir} is not there, and the dashboard clones only when a project is added, or its settings are saved on its own page`,
    cloned,
    // Readable without it, or not at all: a project whose own entry
    // is there is one every reader falls back to, and one whose
    // entry is gone too — a checkout somebody removed by hand, a
    // link pointing at nothing — is a project the board can say
    // nothing about, which is what the banner is for.
    absent: existsSync(t.personEntry),
  };
}

/** Whether the clone at `t.dir` is usable as it is, was cloned just now,
 *  or cannot be used — the last with the answer to give. A check git did
 *  not finish is no answer: said as such, and nothing is decided from it
 *  — not the own-checkout sentence, not a clone. */
export async function prepareClone(
  run: GitRunner,
  t: CloneTarget,
  mayClone: boolean,
  cloned: boolean,
): Promise<"usable" | "cloned" | EnsureResult> {
  const verdict = looksCloned(t.dir) ? await checkUsable(run, t.dir) : null;
  if (verdict?.usable) return "usable";
  if (verdict?.inconclusive) return notKnown(verdict.detail, cloned);
  const refused = refusalFor(t, verdict, mayClone, cloned);
  if (refused) return refused;
  // Read from the person's repository, which is the only place the url
  // is written down.
  const url = await originUrlOf(run, t.ownTop);
  if (!url) {
    return {
      ok: false,
      error: `${t.ownTop} has no origin remote, so the dashboard has nothing to clone its own ${t.label} from`,
      cloned,
    };
  }
  const failed = await cloneFrom(run, url, t.dir);
  if (failed) return { ok: false, error: failed, cloned };
  return "cloned";
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
export function linkWorktreePaths(personDir: string, code: string): void {
  // The clone's own manifest first: it carries the links of a project
  // whose settings the dashboard keeps, and the person's checkout has none.
  const fromClone = resolveWorktreeLinks(code).links;
  const links = fromClone || resolveWorktreeLinks(personDir).links;
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
 *  on their default branch and nobody commits in them — except
 *  `saveSpecFile`/`saveSpecFiles` (`git/specs-pull/`), which commit
 *  and push into the SPECS checkout on every document-tab Save and
 *  Checks-tab tick. It pushes immediately, on the request that made the
 *  edit, under `mergeLock`, so there is nothing else here to lose — and an origin that cannot be reached
 *  should leave the run to work with what it has rather than
 *  refusing. */
export async function bringUpToDate(run: GitRunner, dir: string, wait?: EnsureRequest["wait"]): Promise<void> {
  const branch = await run(dir, ["symbolic-ref", "--short", "HEAD"]);
  const name = branch.code === 0 ? branch.stdout.trim() : "";
  if (!name) return;
  // Under the checkout's lock, as a run's own pull is, with a short wait:
  // the scheduler's tick awaits this for every project with a waiting
  // job, and the next tick tries again.
  const moved = await withCheckoutLock(dir, async () => {
    await run(dir, ["fetch", "--quiet", "origin", name], FETCH_TIMEOUT_MS);
    await run(dir, ["merge", "--ff-only", "--quiet", `origin/${name}`]);
  }, { waitMs: CATCH_UP_LOCK_WAIT_MS, ...(wait ? { wait } : {}) });
  if (!moved.locked) console.error(`checkout: ${dir} not brought up to date — its lock at ${moved.lock} stayed held`);
}
