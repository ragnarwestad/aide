// Resolving where a project's checkouts are — the person's own and the
// dashboard's own — pulled out of `createServer`'s closure the same
// way the earlier clusters were (spec: split serve.ts, step 8).
// `checkoutEnsurer`'s own construction (a single `new CheckoutEnsurer(...)`
// wiring gitRun, checkoutBase, `displayProjectDir` and `complain`
// together) stays in `createServer`: it is built once, not called
// repeatedly, and unlike the functions here it is genuinely a piece of
// boot-time wiring rather than a lookup.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectCheckout } from "../git/branch-status.ts";
import { dashboardCheckoutRoot, type DashboardCheckout } from "../git/dashboard-checkout.ts";
import { resolveCodeLanding, resolveSchedule, type CodeLanding } from "../project/discover.ts";
import type { Job } from "../queue/queue.ts";
import type { QueueTarget } from "../render.ts";

export interface ProjectCheckoutContext {
  queueProjectRoot: string | undefined;
  checkoutBase: string;
  resolvedCheckouts: Map<string, DashboardCheckout>;
  saidAbout: Map<string, string>;
  targets: () => QueueTarget[];
  readScan: () => { specsRoots: Map<string, string> } | null;
}

export const displayProjectDir = (ctx: ProjectCheckoutContext, project: string) =>
  projectCheckout(ctx.queueProjectRoot, project);

/** Whether this project's archived code merges into its default branch
 *  or waits for a pull request (spec 220), read fresh off the
 *  MACHINERY's checkout — the one a run is cut from and a landing
 *  merges in, so the answer is the one the work is actually done
 *  against.
 *
 *  FALLS BACK to the person's checkout while the dashboard has none of
 *  its own. That is not a shortcut, it is the upgrade path: a project
 *  added before this spec, or one whose clone cannot be made at all,
 *  goes on working exactly as it did instead of losing its runs, its
 *  Save and its Update the day this ships. `ensureCheckout` is what
 *  moves it over, and the readiness check is where a clone that cannot
 *  be made is reported by name. */
export function machineryProjectDir(ctx: ProjectCheckoutContext, project: string): string {
  const owned = dashboardCheckoutRoot(ctx.checkoutBase, project);
  return existsSync(join(owned, ".git")) ? owned : displayProjectDir(ctx, project);
}

/** Read per call rather than cached: it is one small YAML file, the
 *  same cost class as the `4-status.md` reads `targets()` already does
 *  per spec, and an operator changing the choice on the settings page
 *  should see the next job honour it rather than the next restart. */
export function codeLanding(ctx: ProjectCheckoutContext, project: string): CodeLanding {
  return resolveCodeLanding(machineryProjectDir(ctx, project));
}

/** The file a `schedule` step's prompt is read from (spec 259),
 *  resolved fresh off the manifest at spawn time — the same
 *  per-call, off-disk reading `codeLanding` above already does, so an
 *  edit to an entry's `prompt:` path takes effect on the next run
 *  rather than the next restart. `undefined` for every step but
 *  `schedule`, and for a schedule job whose entry has since been
 *  removed from the manifest: `aide-run-spec` refuses by name when
 *  `--prompt-file` is missing or the file is gone, rather than this
 *  guessing at one. */
export function promptFileFor(ctx: ProjectCheckoutContext, job: Job, step: string): string | undefined {
  if (step !== "schedule") return undefined;
  if (!job.specFolder.startsWith("schedule-")) return undefined;
  const name = job.specFolder.slice("schedule-".length);
  return resolveSchedule(machineryProjectDir(ctx, job.project)).find((e) => e.name === name)?.prompt;
}

/** Where a project's spec folders are LISTED from (spec 218): the
 *  dashboard's own checkout once one has been resolved, and nothing
 *  otherwise — `discoverProjects` then walks the person's own, exactly
 *  as everything did before spec 205.
 *
 *  The same source a run resolves `--spec` against, which is the whole
 *  point: a folder committed in the person's checkout and never pushed
 *  used to get a row offering four steps, and every one of them
 *  refused with `unknown spec`. Sync and cache-only on purpose — a
 *  render never waits on a clone (spec 208), and `refreshSpecCaches`
 *  is what keeps the answer current.
 *
 *  Passed to every walk that lists specs FOR A READER, and to no
 *  other: the `fs.watch` loop watches the person's own checkout for
 *  local edits and must go on watching it, and `refreshDrift` reads
 *  nothing off the walk but `p.name`. */
export function ownedSpecsRoot(ctx: ProjectCheckoutContext, project: string): string | undefined {
  return ctx.resolvedCheckouts.get(project)?.specs;
}

/** The specs root the machinery works in: the dashboard's own once it
 *  has one, and otherwise the scan's answer — the person's, which is
 *  the root everything used before this spec. */
export function machinerySpecsRoot(ctx: ProjectCheckoutContext, project: string): string | undefined {
  const owned = ctx.resolvedCheckouts.get(project);
  if (owned) return owned.specs;
  ctx.targets();
  return ctx.readScan()?.specsRoots.get(project);
}

/** The last thing said about each project, so a refusal that has not
 *  changed is not said again. Every tick asks, and a project whose
 *  origin is unreachable would otherwise fill the log with one line
 *  every two seconds for as long as the server runs. */
export function complain(ctx: ProjectCheckoutContext, project: string, said: string): void {
  if (ctx.saidAbout.get(project) === said) return;
  ctx.saidAbout.set(project, said);
  console.error(`queue: the dashboard's own checkout of ${project} — ${said}`);
}
