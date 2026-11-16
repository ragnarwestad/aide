// Whether a checkout is one git can answer for: yes, no, or not known.
//
// "Not known" is its own answer because a `rev-parse` the runner's timer
// cut off comes back as a non-zero exit with nothing on stdout — the same
// shape as git saying "not a repository". Under load on the serving host
// both attempts were cut off, and the board told the reader that a
// healthy checkout was broken. A check git did not finish decides
// nothing: `ensureDashboardCheckout` says so and checks again later.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../process/index.ts";
import { realPathOrAbsolute as real } from "../real-path.ts";

const TOPLEVEL = ["rev-parse", "--show-toplevel"];

/** A top level, or why there is none: `finished` is whether git ran to
 *  its own end, and `detail` names the check and what came back. */
export type Top = { top: string } | { top: null; finished: boolean; detail: string };

export type Usable = { usable: true } | { usable: false; inconclusive: boolean; detail: string };

const HOW_IT_ENDED = {
  "timed-out": "did not answer in time",
  killed: "was stopped before it answered",
  "not-started": "could not be started",
} as const;

/** The top level of the repository `dir` is in. A directory that is not
 *  there is a finished answer, said without a subprocess. */
export async function askTop(run: GitRunner, dir: string): Promise<Top> {
  const check = `git ${TOPLEVEL.join(" ")} in ${dir}`;
  if (!existsSync(dir)) return { top: null, finished: true, detail: `${dir} is not there` };
  const res = await run(dir, TOPLEVEL);
  if (res.unfinished) return { top: null, finished: false, detail: `${check} ${HOW_IT_ENDED[res.unfinished]}` };
  if (res.code === 0 && res.stdout.trim()) return { top: real(res.stdout.trim()) };
  const said = (res.stderr ?? "").trim().split("\n")[0];
  return { top: null, finished: true, detail: `${check} failed (exit ${res.code})${said ? `: ${said}` : ""}` };
}

/** Whether there is anything here claiming to be a checkout. The
 *  ordinary first use answers `false`, and it answers without a
 *  subprocess and without suspending — which the caller depends on:
 *  the cold-render budget counts the git commands a cold page render spawns, and an
 *  `await` reached on the nothing-is-there path moves the first clone's
 *  own git call out of boot and into the next request. */
export const looksCloned = (dir: string): boolean => existsSync(join(dir, ".git"));

/** Whether a checkout is one a run can work in — present is not the
 *  same as finished. A clone killed part-way through leaves a `.git`
 *  holding `objects` and no `HEAD`, which `existsSync` reads as done
 *  and git reads as no repository at all.
 *
 *  Asked TWICE before a "no" is believed, because this is the answer
 *  that decides whether the checkout is reported as broken. A run's
 *  worktree is cut from `code` with `git worktree add` and goes on
 *  reading `code/.git` for its whole duration, so a single flaky
 *  `rev-parse` must not turn a healthy, live checkout into a refused
 *  one. Two finished "no"s in a row is "git cannot answer this
 *  question", which is the same bar `aide-run-spec` accepts before it
 *  refuses; an attempt git did not finish makes the answer not known. */
export async function checkUsable(run: GitRunner, dir: string): Promise<Usable> {
  const first = await askTop(run, dir);
  if (first.top !== null) return { usable: true };
  const second = await askTop(run, dir);
  if (second.top !== null) return { usable: true };
  const unfinished = !first.finished ? first : !second.finished ? second : null;
  return { usable: false, inconclusive: unfinished !== null, detail: (unfinished ?? second).detail };
}

/** The dashboard's own sentence for a check git did not finish: which
 *  check, how it ended, and that nothing was done and it is asked again. */
export function notCheckedYet(detail: string): string {
  return `${detail}, so it is not known yet whether git can use it — the dashboard leaves it as it is and checks again on its own`;
}
