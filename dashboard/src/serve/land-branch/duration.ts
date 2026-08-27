// What a spec cost in time, written into its own `4-status.md` once
// its archive has landed (spec 207). Split out of land-branch.ts by
// theme (split land-branch.ts by theme).

import { join } from "node:path";
import type { Job } from "../../queue/queue.ts";
import { lastCommitOf } from "../../git/description-freshness.ts";
import { saveSpecFile } from "../../git/specs-pull.ts";
import { specDurationMs, specFileText, stampDuration } from "../../project/discover.ts";
import { parseStatus } from "../../project/parse-status.ts";
import { computeSpecTotalDurationMs, STATUS_SPEC_FILE } from "../../render.ts";
import { withFreshness } from "./freshness.ts";
import type { LandContext } from "./types.ts";

/** What the spec cost in TIME, written into its own `4-status.md`
 *  once its archive has landed (spec 207).
 *
 *  The spec list has always shown this — the phases added together —
 *  but it is worked out from the queue's job records, and the queue
 *  keeps two hundred jobs on one machine while the archive holds
 *  ninety specs and grows. So most archived rows would have no figure
 *  and never would, unless it is written down. Written down, it
 *  survives the queue forgetting, the machine changing and the year
 *  turning, which is the whole reason to want it.
 *
 *  Neither half of the runner can do this: `core/skills/aide-archive`
 *  reads markdown and runs git, and `core/scripts/aide-run-spec`
 *  derives what it knows from commit subjects. The per-step timings
 *  live only in this process's `QueueStore`, so the write happens
 *  here.
 *
 *  Four things it will not do:
 *
 *  - It does not compute the sum itself. `computeSpecTotalDurationMs`
 *    is the spec list's own function, and `done` comes from the same
 *    `withFreshness` the list calls — so "the stored figure equals
 *    what the list showed" holds by construction rather than by two
 *    implementations staying in step.
 *  - It does not write twice. 133 was archived three times; a second
 *    landing finds the stamp already there and leaves it alone.
 *  - It does not write in a person's checkout. The merge above landed
 *    in the machinery's own (spec 205), which is also where the
 *    archive step's `git mv` has just moved the folder — so the
 *    archived path is tried first and the active one second, the same
 *    two-candidate shape `aide_resolve_spec` uses in bash.
 *  - It does not fail anything. A refusal is logged and left there;
 *    what it leaves is a blank cell, which the archive page already
 *    draws for every spec finished before this existed. */
export async function stampTotalDuration(ctx: LandContext, job: Job): Promise<void> {
  const root = ctx.machinerySpecsRoot(job.project);
  if (!root) return;
  const dir = [join(root, "archive", job.specFolder), join(root, job.specFolder)].find(
    (candidate) => specFileText(candidate, STATUS_SPEC_FILE) !== null,
  );
  if (!dir) return;
  // Already recorded: a re-run of `archive` must not grow a second
  // bullet, nor overwrite the first with a figure measured over a
  // different set of jobs. Read before anything expensive is done.
  if (specDurationMs(dir) !== null) return;
  const current = specFileText(dir, STATUS_SPEC_FILE);
  if (current === null) return;
  // The list's own done-set, from the list's own function — NOT the
  // job results. A step a job completed is not necessarily a step
  // that counts: `withFreshness` takes `analyze` back out when the
  // description moved on after it, and the list then shows no total.
  const spec = {
    project: job.project,
    specFolder: job.specFolder,
    dir,
    reopenedAfter: parseStatus(current).reopenedAfter,
  };
  // `withFreshness` is a peek since spec 208, and this spec has just
  // been archived — the schedule walks the LIVE list, so nothing has
  // ever asked git about this folder. Warmed first, deliberately:
  // this is a landing, not a render, and a figure worked out from
  // "not yet known" would be written down and outlive the mistake.
  await ctx.warmSpec(spec);
  const [fresh] = withFreshness(ctx, [spec]);
  const rows = await Promise.all(
    ctx.queue
      .list()
      .filter((j) => j.project === job.project && j.specFolder === job.specFolder)
      .map(ctx.jobRow),
  );
  // This job's own `landing` flag is still true here — it is cleared
  // only once the runner's promise for `onLanded` (this very function)
  // settles, on purpose, so a `tick()` interleaved mid-landing cannot
  // reuse its concurrency slot (`runner.ts`). `totalDuration`'s
  // in-flight guard reads that same flag as "not finished yet", which
  // is right for the row a reader sees but wrong here: this landing
  // reaching `onLanded` at all means the step is done, and the total is
  // being asked for BECAUSE of that, not despite it.
  for (const r of rows) if (r.id === job.id) r.landing = undefined;
  const ms = computeSpecTotalDurationMs(rows, fresh?.done ?? []);
  if (ms === undefined) return;
  const text = stampDuration(current, ms);
  // Nowhere to put the line — a `4-status.md` with no Tracking info
  // section — comes back unchanged, and there is nothing to save.
  if (text === current) return;
  const baseSha = (await lastCommitOf(ctx.gitRun, dir, STATUS_SPEC_FILE))?.sha ?? null;
  // The same lock the merge above just used and let go of, for the
  // same hazard: every spec shares the specs root, so this write must
  // not run beside a save, a pull, or a second landing.
  const result = await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
    saveSpecFile(ctx.gitRun, dir, (r) => ctx.branchStatus.defaultBranch(r), {
      file: STATUS_SPEC_FILE,
      text,
      baseSha,
      specLabel: job.specFolder,
      message: `Record what ${job.specFolder} cost in time`,
    }),
  );
  if (!result.ok) {
    console.error(`queue: recording ${job.project}/${job.specFolder}'s time spent — ${result.note}`);
  }
}
