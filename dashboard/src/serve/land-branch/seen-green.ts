// Whether the landing is about to test code a step has already seen
// green. `implement` is the one step that runs the suite itself
// (`run-spec-step-tests.sh`), and it records the tree it saw green on;
// when main has not moved since, the landing's own merge is that same
// tree, and running the same commands on it a second time costs a whole
// suite to learn nothing (spec 480, 2026-09-18). When main HAS moved,
// the trees differ and the landing runs as before.

import type { Job } from "../../queue/queue.ts";
import { resolveWorktreeLinks } from "../../project/discover";
import { runScript, scriptFor } from "./run-script.ts";

/** The tree `dir` holds, hashed the way `aide_tree_hash` hashes a step's
 *  worktree — the same function, so the two answers are comparable at
 *  all. The links are handed over from the live checkout: a fresh
 *  worktree carries no `.aide/config` to read them from. `undefined`
 *  when the hash cannot be taken, which skips nothing. */
async function treeOf(dir: string, liveRoot: string, scriptDir?: string): Promise<string | undefined> {
  const lib = scriptFor("_aide-spec-lib.sh", { beside: scriptDir, override: process.env.AIDE_SPEC_LIB });
  // The live checkout's own answer first; the tree's when it has none —
  // a project that keeps its settings in the dashboard has them in an
  // untracked manifest the gate copied into the tree (spec 512).
  const links = resolveWorktreeLinks(liveRoot).links || resolveWorktreeLinks(dir).links || "";
  const hashed = await runScript(
    ["/bin/bash", "-c", 'source "$1" && aide_tree_hash "$2" "$3"', "_", lib, dir, links],
    dir,
    60_000,
  );
  const tree = hashed.stdout.trim();
  return hashed.code === 0 && /^[0-9a-f]{40,64}$/.test(tree) ? tree : undefined;
}

/** What the gate knows of the job it lands: `results` is absent for a
 *  caller that has none to give, and then nothing is skipped. */
export type GatedJob = Pick<Job, "project" | "specFolder"> & { results?: Job["results"]; id?: string };

/** The newest green the job's own steps reported: the step that just
 *  ran is the one whose result the landing is merging. */
function latestGreen(job: GatedJob): { tree: string; commands: string[] } | undefined {
  const results = job.results ?? [];
  for (let i = results.length - 1; i >= 0; i--) {
    const green = results[i]?.testedGreen;
    if (green) return green;
  }
  return undefined;
}

const sameCommands = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().every((c, i) => c === [...b].sort()[i]);

/** The tree a skipped run would have tested, when a step of this job has
 *  already seen exactly these commands green on exactly this tree.
 *  Anything short of that — no green on record, other commands, another
 *  tree, a hash that could not be taken — is `undefined`, and the
 *  landing runs. */
export async function alreadySeenGreen(
  dir: string,
  liveRoot: string,
  job: GatedJob,
  commands: string[],
  opts: { scriptDir?: string } = {},
): Promise<string | undefined> {
  const green = latestGreen(job);
  if (!green || !sameCommands(green.commands, commands)) return undefined;
  const tree = await treeOf(dir, liveRoot, opts.scriptDir);
  return tree && tree === green.tree ? tree : undefined;
}
