// Whether a generated page still matches the files it was written from.
// The same rule as `aide-wiki status` (`core/scripts/aide-wiki`), asked once
// per distinct commit rather than once per page; `test/project/wiki/state.test.ts`
// holds the two to the same answer on one repository.

import type { GitRunner } from "../../git/branch-status.ts";
import type { PageMark } from "./parse.ts";

export type WikiPageState = "current" | "changed" | "unknown" | "hand-written";

const COMMIT = /^[0-9a-f]{7,40}$/;

/** The files that differ between `commit` and the project's HEAD, or null
 *  when the commit is not one the project has or git cannot say. */
async function changedSince(run: GitRunner, projectDir: string, commit: string): Promise<Set<string> | null> {
  if (!COMMIT.test(commit)) return null;
  const has = await run(projectDir, ["cat-file", "-e", `${commit}^{commit}`]);
  if (has.code !== 0) return null;
  // -z keeps a non-ASCII name from being quoted out of the comparison, and
  // --no-renames lists the old path of a renamed file as changed.
  const diff = await run(projectDir, ["diff", "--name-only", "-z", "--no-renames", commit, "HEAD"]);
  if (diff.code !== 0) return null;
  return new Set(diff.stdout.split("\0").filter(Boolean));
}

/** Each page's state: `changed` when a file it names differs from what the
 *  project has now, `unknown` when that cannot be told — never `current` by
 *  default — and `hand-written` for a page with no mark. */
export async function pageStates(
  run: GitRunner,
  projectDir: string,
  marks: Map<string, PageMark>,
): Promise<Map<string, WikiPageState>> {
  const commits = new Set([...marks.values()].filter((m) => m.generated).map((m) => m.commit));
  const answers = new Map<string, Set<string> | null>();
  await Promise.all([...commits].map(async (c) => answers.set(c, await changedSince(run, projectDir, c))));
  const states = new Map<string, WikiPageState>();
  for (const [page, mark] of marks) {
    if (!mark.generated) { states.set(page, "hand-written"); continue; }
    const changed = answers.get(mark.commit);
    states.set(page, !changed ? "unknown" : mark.files.some((f) => changed.has(f)) ? "changed" : "current");
  }
  return states;
}
