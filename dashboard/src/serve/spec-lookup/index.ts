// Resolving a spec's folder, its checked-out location and which of its
// two repos still hold its branch — pulled out of `createServer`'s
// closure the same way the earlier clusters were (spec: split serve.ts,
// step 7). An explicit context object stands in for the locals these
// functions used to read directly.
//
// `peekUnlanded` is the one function here that used to WRITE the
// `unlanded`/`prOpen` `let`s directly. It still needs to — `resolveProject`
// (staying in serve.ts) reads `unlanded`, and `specViewsCtx.readPrOpen`
// reads `prOpen` — so it RETURNS both computed lists instead, and the
// thin wrapper in serve.ts does the two assignments. Every other
// function here is a plain read.

import { existsSync } from "node:fs";
import { resolve, sep, join } from "node:path";
import { SCAN_TTL_MS, type BranchStatusChecker } from "../../git/branch-status.ts";
import type { GitRunner } from "../../git/process/index.ts";
import type { BranchFileStepsChecker } from "../../git/workflow-history.ts";
import { specBranch } from "../../project/spec-names.ts";
import { branchForSpec, type GroupFirsts } from "../../project/discover/group.ts";
import { dashboardSpecDir, type DashboardCheckout } from "../../git/dashboard-checkout/index.ts";
import type { CodeLanding, SpecRef } from "../../project/discover";
import type { PullRequestAnswer } from "../../integrations/pull-requests.ts";
import type { SpecTarget } from "../../project/spec-facts.ts";
import { scanSpecs } from "./scan.ts";

/** What `targets()` caches for five seconds and every other lookup in
 *  this file reads a slice of. */
export interface ScanState {
  at: number;
  targets: SpecTarget[];
  archived: string[];
  dirs: Map<string, string>;
  refs: Map<string, SpecRef>;
  specsRoots: Map<string, string>;
}

export interface SpecLookupContext {
  machineryProjectDir: (project: string) => string;
  machinerySpecsRoot: (project: string) => string | undefined;
  branchStatus: BranchStatusChecker;
  codeLanding: (project: string) => CodeLanding;
  /** `undefined` for a normal call; `targets()` itself supplies this
   *  when it rebuilds the scan, so every OTHER function in this file
   *  keeps calling `ctx.targets()` with no argument and gets the same
   *  five-second cache `targets()` has always kept. */
  targets: () => SpecTarget[];
  readScan: () => ScanState | null;
  writeScan: (scan: ScanState | null) => void;
  projectRoot: string | undefined;
  allowed: Set<string>;
  ownedSpecsRoot: (project: string) => string | undefined;
  gitRun: GitRunner;
  resolvedCheckouts: Map<string, DashboardCheckout>;
  ensureCheckout: (project: string) => Promise<DashboardCheckout | undefined>;
  /** The branch copy of `4-status.md`/`.json`, as the schedule last read
   *  it (the branch-steps checker). Attached after the schedules exist, so
   *  optional; absent, every read below is off disk. */
  readBranchFileSteps?: () => BranchFileStepsChecker | undefined;
  /** What GitHub last said about each archived spec's pull request,
   *  keyed `project/folder`; absent, git's answer is the only one. */
  pullRequests?: Map<string, PullRequestAnswer>;
}

/** Where every spec's four files are, ARCHIVED ONES INCLUDED.
 *  `targets` deliberately drops an archived spec — a ghost row
 *  outliving the spec is what that costs — but the archive job that
 *  moved it still has a page, and that page's whole content is the
 *  stamp in the folder it moved to.
 *
 *  Cached for five seconds off `ctx.readScan()`/`ctx.writeScan()` —
 *  the same `scan` `let` every other function in this file peeks
 *  through `readScan()`. */
export function targets(ctx: SpecLookupContext): SpecTarget[] {
  const now = Date.now();
  const cached = ctx.readScan();
  if (cached && now - cached.at < SCAN_TTL_MS) return cached.targets;
  const scan = scanSpecs(ctx, now);
  ctx.writeScan(scan);
  return scan.targets;
}

/** The two repositories a spec's work can be open in — landing checks
 *  both; the dependency gate asks only the LAST one, the
 *  specs root, since "archived" is a fact about one folder in one
 *  repository. */
export function specRoots(ctx: Pick<SpecLookupContext, "machineryProjectDir" | "machinerySpecsRoot">, project: string): string[] {
  const code = ctx.machineryProjectDir(project);
  const specs = ctx.machinerySpecsRoot(project);
  const both = specs && resolve(specs) !== resolve(code) ? [code, specs] : [code];
  // Only roots that are THERE. A project with no specs root configured
  // resolves to `<project>/specs`, and two projects on this host have
  // never had one — asking git about a directory that does not exist
  // is not an unanswerable question, it is a question about nothing.
  return both.filter((d) => existsSync(d));
}

/** Which of a project's roots still have `branch` on origin. A root
 *  that cannot be ASKED contributes nothing: an unanswerable question
 *  is not evidence, either way. */
export async function rootsStillHolding(
  ctx: SpecLookupContext,
  project: string,
  branch: string,
  fresh: boolean,
): Promise<string[]> {
  const held = new Set<string>();
  for (const root of specRoots(ctx, project)) {
    const open = await ctx.branchStatus.openSpecBranches(root, fresh);
    if (open?.has(branch)) held.add(await specsRoot(ctx, root));
  }
  return [...held];
}

/** A specs root INSIDE the project is the same repository, so it holds
 *  the same one branch and answers `ls-remote` identically. Counting it
 *  as a second root would call every single-repo project's review a
 *  failed landing, and paceup and atlasaurus are both shaped that way. */
function inCodeRepo(codeRoot: string, root: string): boolean {
  return root === codeRoot || resolve(root).startsWith(resolve(codeRoot) + sep);
}

/** Rebuild `unlanded` from one `ls-remote` per ROOT — never one per
 *  spec. The archived keys come off the scan the page already keeps,
 *  and the intersection is done in memory. */
export function peekUnlanded(ctx: SpecLookupContext): { unlanded: string[]; prOpen: string[] } {
  ctx.targets();
  const keys = ctx.readScan()?.archived ?? [];
  if (keys.length === 0) return { unlanded: [], prOpen: [] };
  const byProject = new Map<string, string[]>();
  for (const key of keys) {
    const cut = key.indexOf("/");
    const project = key.slice(0, cut);
    const list = byProject.get(project);
    if (list) list.push(key.slice(cut + 1));
    else byProject.set(project, [key.slice(cut + 1)]);
  }
  const found: string[] = [];
  const reviewing: string[] = [];
  const byRoot = new Map<string, GroupFirsts>();
  for (const [project, folders] of byProject) {
    const open = new Set<string>();
    // Kept apart from the union above: which ROOT holds a
    // branch is what tells "waiting on a review" from "the landing did
    // not finish", and folding the roots together loses it.
    const elsewhere = new Set<string>();
    const codeRoot = ctx.machineryProjectDir(project);
    const pr = ctx.codeLanding(project) === "pr";
    for (const root of specRoots(ctx, project)) {
      // A root nobody has asked about yet peeks `null`, and `?? []`
      // makes it contribute nothing — the same way an unanswerable
      // one already did. That is what keeps this failing closed
      // without any new logic to get wrong.
      for (const branch of ctx.branchStatus.peekOpenSpecBranches(root).open ?? []) {
        open.add(branch);
        if (!inCodeRepo(codeRoot, root)) elsewhere.add(branch);
      }
    }
    for (const folder of folders) {
      const archivedDir = join(ctx.machinerySpecsRoot(project) ?? "", "archive", folder);
      const branch = existsSync(archivedDir) ? branchForSpec(archivedDir, folder, byRoot) : specBranch(folder);
      if (!open.has(branch)) continue;
      found.push(`${project}/${folder}`);
      if (pr && !elsewhere.has(branch)) reviewing.push(`${project}/${folder}`);
    }
  }
  return { unlanded: found, prOpen: reviewing };
}

/** GitHub's answer when it says the spec's pull request merged, for a
 *  project that reviews its code and a root in the code repository. A
 *  specs root of its own is merged at archive, so git alone answers. */
export function mergedPullRequest(
  ctx: Pick<SpecLookupContext, "machineryProjectDir" | "codeLanding" | "pullRequests">,
  project: string,
  folder: string,
  root: string,
): PullRequestAnswer | undefined {
  if (ctx.codeLanding(project) !== "pr" || !inCodeRepo(ctx.machineryProjectDir(project), root)) return undefined;
  const answer = ctx.pullRequests?.get(`${project}/${folder}`);
  return answer?.merged ? answer : undefined;
}

/** Whether an archived spec's open branch is merged in every root that
 *  still holds it: only a cleanup is left. A root never asked, or one
 *  that answered "not merged", makes it false, and the row reads "not
 *  landed" as before. Peeks only, like `peekUnlanded`. A squash merge
 *  leaves the branch outside the default branch for good, so a project
 *  that reviews its code also counts a merged pull request. */
export function peekMergedOnOrigin(ctx: SpecLookupContext, project: string, folder: string): boolean {
  const archivedDir = join(ctx.machinerySpecsRoot(project) ?? "", "archive", folder);
  const branch = existsSync(archivedDir) ? branchForSpec(archivedDir, folder) : specBranch(folder);
  const holding = specRoots(ctx, project).filter((r) => ctx.branchStatus.peekOpenSpecBranches(r).open?.has(branch));
  return (
    holding.length > 0 &&
    holding.every((r) => ctx.branchStatus.peekMerged(r, branch) === true || !!mergedPullRequest(ctx, project, folder, r))
  );
}

/** When the set was last taken, for the archive page's own label: an
 *  answer this old is SHOWN with its age rather than withheld, the
 *  same treatment `driftPrefix` gives the commits-behind count. The
 *  OLDEST of the roots asked, because the badge speaks for all of
 *  them, and `null` where any root has never been asked at all. */
export function peekUnlandedCheckedAt(ctx: SpecLookupContext): number | null {
  ctx.targets();
  const keys = ctx.readScan()?.archived ?? [];
  let oldest: number | null = null;
  for (const key of keys) {
    for (const root of specRoots(ctx, key.slice(0, key.indexOf("/")))) {
      const { checkedAt } = ctx.branchStatus.peekOpenSpecBranches(root);
      if (checkedAt === null) return null;
      oldest = oldest === null ? checkedAt : Math.min(oldest, checkedAt);
    }
  }
  return oldest;
}

/** A spec's folder on this host, archived or not. Goes through
 *  `targets()` so it shares the 5-second scan rather than walking the
 *  projects root again — but what it returns is only WHERE the files
 *  are; the files themselves are read fresh on every request, which
 *  is the whole point of the Update button. */
export function specDir(ctx: SpecLookupContext, project: string, specFolder: string): string | undefined {
  ctx.targets();
  return ctx.readScan()?.dirs.get(`${project}/${specFolder}`);
}

/** What that spec IS — its title, and whether it has been archived
 *  Through the same 5-second scan `specDir` goes through,
 *  and unlike `targets()` it answers for an archived spec too. */
export function specRef(ctx: SpecLookupContext, project: string, specFolder: string): SpecRef | undefined {
  ctx.targets();
  return ctx.readScan()?.refs.get(`${project}/${specFolder}`);
}

/** The checkout a spec folder sits in — the lock key for everything
 *  that touches the specs repository.
 *
 *  `createRootLock`'s own docstring says what it is for: "per repo
 *  ROOT, not global: two requests that touch no directory in common
 *  cannot collide." The Update button was locking on `specDir(...)`,
 *  the individual spec's subfolder, and every project and every spec
 *  in a specs checkout shares ONE `.git` — so two presses on
 *  different specs were given different keys and ran two git
 *  sequences in one working tree. Latent while the only write was a
 *  fast-forward merge; not latent beside a Save that writes, commits
 *  and pushes.
 *
 *  Read-only and outside the lock, which is where it has to be: it is
 *  what decides which lock to take. A directory git will not answer
 *  for keys on itself, which is what the routes did before and is no
 *  worse — the save's own first question refuses it by name. */
export async function specsRoot(ctx: SpecLookupContext, dir: string): Promise<string> {
  const top = await ctx.gitRun(dir, ["rev-parse", "--show-toplevel"]);
  return top.code === 0 && top.stdout.trim() ? top.stdout.trim() : dir;
}

/** The dashboard's own copy of the spec folder the display found
 *  Save COMMITS and PUSHES, and Update merges — all three
 *  are writes, and the checkout a person edits stopped taking writes
 *  from the dashboard.
 *
 *  The translation is needed rather than a second closure because the
 *  routes do not resolve a project root at all: `specDir()` hands them
 *  a directory off the scan of the projects root, and what they need
 *  is the same folder inside the clone the dashboard owns.
 *
 *  Falls back to the person's folder when there is no such clone —
 *  see `ensureCheckout`: a project the dashboard cannot clone keeps
 *  working exactly as it did before this spec. */
export async function machinerySpecDir(ctx: SpecLookupContext, project: string, dir: string): Promise<string> {
  // The cached answer where there is one: this runs on every spec
  // page, every edit form and every save, and `ensureDashboardCheckout`
  // spawns git twice to work out where a project's specs are. Boot,
  // the runner's tick and the Settings route all re-ensure, so a
  // specs root that moves still reaches this map.
  const checkout = ctx.resolvedCheckouts.get(project) ?? (await ctx.ensureCheckout(project));
  if (!checkout) return dir;
  ctx.targets();
  const personSpecs = ctx.readScan()?.specsRoots.get(project);
  const translated = personSpecs ? dashboardSpecDir(checkout, personSpecs, dir) : null;
  return translated ?? dir;
}

/** The same translation, without ever awaiting a clone.
 *
 *  `ensureCheckout` is started at boot for every allowed project, but
 *  a clone of this very repo measured 4.3 s (measured on this host)
 *  — so a spec page opened during the first minutes of a restart
 *  joined that promise and held the reader for its whole duration,
 *  showing the OLD page unchanged while it did. That is the literal
 *  shape of "the app answers at once and never waits on git" stated
 *  as a bug.
 *
 *  So "not made yet" now behaves exactly as "cannot be made" already
 *  did: fall back to the person's own folder, which is what every
 *  project used before checkouts were made and what a project the
 *  dashboard cannot clone still uses. The clone goes on in the
 *  background and the next view reads through it.
 *
 *  READ paths only, and only the ones with no form on them.
 *  `machinerySpecDir` is untouched and its other callers still await:
 *  the spec page's own Description TAB (where `/edit` used
 *  to be) has to read through the SAME checkout Save will later write
 *  through, or Save's compare-stamp check refuses as "changed since
 *  you opened it" the first time anyone edits a spec shortly after a
 *  restart. */
export function peekMachinerySpecDir(ctx: SpecLookupContext, project: string, dir: string): string {
  const checkout = ctx.resolvedCheckouts.get(project);
  if (!checkout) {
    // Started, not waited on — so a page opened before the boot-time
    // ensure settles still gets the clone going for the next one.
    void ctx.ensureCheckout(project);
    return dir;
  }
  ctx.targets();
  const personSpecs = ctx.readScan()?.specsRoots.get(project);
  return (personSpecs ? dashboardSpecDir(checkout, personSpecs, dir) : null) ?? dir;
}
