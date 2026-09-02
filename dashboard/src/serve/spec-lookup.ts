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

import { existsSync, readFileSync } from "node:fs";
import { resolve, sep, join } from "node:path";
import type { BranchStatusChecker, GitRunner } from "../git/branch-status.ts";
import { specBranch } from "../git/branch-status.ts";
import { dashboardSpecDir, type DashboardCheckout } from "../git/dashboard-checkout.ts";
import {
  discoverProjects, specDependsOn, type CodeLanding, type SpecRef,
} from "../project/discover.ts";
import {
  ACCEPTANCE_CRITERIA_UNTICKED_NOTE, archiveHeldBackReason, parseStatus,
} from "../project/parse-status.ts";
import { currentPhase, readSpecState } from "../project/parse-spec-state.ts";
import type { QueueTarget } from "../render.ts";
import { resolveDependencyFolder } from "./serve-helpers.ts";

/** What `targets()` caches for five seconds and every other lookup in
 *  this file reads a slice of. */
export interface ScanState {
  at: number;
  targets: QueueTarget[];
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
  targets: () => QueueTarget[];
  readScan: () => ScanState | null;
  writeScan: (scan: ScanState | null) => void;
  projectRoot: string | undefined;
  allowed: Set<string>;
  ownedSpecsRoot: (project: string) => string | undefined;
  gitRun: GitRunner;
  resolvedCheckouts: Map<string, DashboardCheckout>;
  ensureCheckout: (project: string) => Promise<DashboardCheckout | undefined>;
}

/** Where every spec's four files are, ARCHIVED ONES INCLUDED (spec
 *  150). `targets` deliberately drops an archived spec — a ghost row
 *  outliving the spec is what that costs — but the archive job that
 *  moved it still has a page, and that page's whole content is the
 *  stamp in the folder it moved to.
 *
 *  Cached for five seconds off `ctx.readScan()`/`ctx.writeScan()` —
 *  the same `scan` `let` every other function in this file peeks
 *  through `readScan()`. */
export function targets(ctx: SpecLookupContext): QueueTarget[] {
  const now = Date.now();
  const cached = ctx.readScan();
  if (cached && now - cached.at < 5000) return cached.targets;
  const found: QueueTarget[] = [];
  const gone: string[] = [];
  // And WHAT each of them is, from the same walk (spec 163). `targets`
  // is live-only by design, so the page of an ARCHIVED spec looked its
  // title up in a list that could not hold it and rendered no
  // description line at all — silently, because the H1 comes from the
  // folder name. One lookup answers the title and whether the spec is
  // archived, for every spec there is.
  const refs = new Map<string, SpecRef>();
  const dirs = new Map<string, string>();
  const specsRoots = new Map<string, string>();
  if (ctx.projectRoot) {
    for (const p of discoverProjects(ctx.projectRoot, ctx.ownedSpecsRoot)) {
      if (!ctx.allowed.has(p.name)) continue;
      specsRoots.set(p.name, p.specsRoot);
      for (const s of p.specs) {
        dirs.set(`${p.name}/${s.folder}`, s.dir);
        refs.set(`${p.name}/${s.folder}`, s);
        // Remembered by key: a create job keeps its group visible
        // while its spec has not landed, and "archived" is the one
        // proof that it HAS — without it the ghost row outlives the
        // spec (seen with 111/112 on 2026-08-19).
        if (s.archived) {
          gone.push(`${p.name}/${s.folder}`);
          continue;
        }
        // What a reader needs to CHOOSE a spec: what it is called and
        // how far it has got. spec 355 (REQ-3): the state-bearing
        // fields (phase, fileSteps, reopenedAfter, the acceptance-
        // criteria half of heldBack) come from the state file, through
        // the one reader — never from a fresh parse of the prose. The
        // prose itself is still read once, for the ONE thing that
        // stays prose-only: the `## Archive held back` section, which
        // is display text `4-status.json`'s schema does not carry.
        let statusText = "";
        try {
          statusText = readFileSync(join(s.dir, "4-status.md"), "utf-8");
        } catch {
          statusText = "";
        }
        const state = readSpecState(s.dir);
        // The dependency-gated reason first (still checked, though
        // largely retired by spec 268), then the far more common one
        // today: archive's own acceptance-criteria gate (spec 285)
        // refusing until a person ticks those rows — a healthy wait,
        // not a failure, and one a bare "ready" row otherwise gives no
        // reason for. `ACCEPTANCE_CRITERIA_UNTICKED_NOTE` is the one
        // string `restingChip()` (job-state/resting.ts) checks for to
        // keep this case's badge "ready" rather than the dependency
        // case's "waiting" — the two share this field because both are
        // archive declining to proceed, but only one of them is
        // ordinary, expected progress.
        const acceptanceOpen = state?.acceptanceCriteria.some((row) => !row.done) ?? false;
        const heldBack = statusText
          ? (archiveHeldBackReason(statusText) ?? (acceptanceOpen ? ACCEPTANCE_CRITERIA_UNTICKED_NOTE : null))
          : null;
        found.push({
          project: p.name,
          specFolder: s.folder,
          // Where the freshness check runs git. Never rendered — the
          // page has no use for an absolute path, and `targets` is
          // server-side only.
          dir: s.dir,
          title: s.title ?? undefined,
          description: s.description ?? undefined,
          // What its own 1-description.md says it builds on (spec 92),
          // shown on its row in the same words the run's dependency
          // refusal uses.
          dependsOn: s.dependsOn,
          phase: (state ? currentPhase(state) : null) ?? undefined,
          // The FILES, and nothing else (spec 108). It used to be
          // unioned with the queue's own record of what it ran, so
          // either one being true was enough — which is how an
          // archive job that finished without moving anything counted
          // as an archived spec, and how a phase could read "done" on
          // a row whose files said otherwise. What a job reported is
          // still shown, as a qualifier — in the row's own panel since
          // spec 195, not on the phase's line.
          //
          // One line of that file, and no inference from any other
          // (spec 139): each step writes its own name into
          // `4-status.md` once it has succeeded. The three heuristics
          // this replaces — the size of 2-analysis.md, a heading in
          // 3-solution.md, and 4-status.md's own progress percentage,
          // which used to be read on this line — each answered a
          // question next to the one being asked, and the first of
          // them marked spec 138 analysed before any analyze had run.
          // The percentage left the row entirely in spec 167.
          //
          // Since spec 154 the line is no longer the ANSWER, only a
          // claim: a model has to reach its last instruction to write
          // it and a copied folder brings a sibling's version along.
          // `withFreshness` fills `done` in from the runner's own
          // commits, and this is what it compares them against.
          // The prose's own steps line, AND the state file's own claim
          // when this spec has one — kept apart rather than collapsed
          // into one array (spec 362), so `resolveWorkflowState` can
          // stop comparing the state file against git once one exists:
          // a git-history comparison of a state-file spec compares two
          // records that can legitimately disagree for reasons that
          // mean nothing (spec 349).
          fileSteps: { proseSteps: parseStatus(statusText).workflowSteps, stateSteps: state?.completedPhases },
          // Where this spec's history starts, when it has been
          // reopened (spec 198). Off the same state file as `fileSteps`
          // and `heldBack`'s acceptance half.
          reopenedAfter: state?.reopened?.boundaryCommit,
          archiveHeldBack: heldBack ? { reason: heldBack } : undefined,
          // spec 355 (REQ-10): a spec whose files exist but has no
          // state file yet — not touched by a writer script since this
          // feature shipped, or an archived spec the backfill has not
          // reached. Never for a brand-new spec with no 4-status.md at
          // all, which is ordinary "not started yet", not a gap.
          stateMissing: statusText ? state === null : undefined,
        });
      }
    }
  }
  ctx.writeScan({ at: now, targets: found, archived: gone, dirs, refs, specsRoots });
  return found;
}

/** The two repositories a spec's work can be open in — the same pair
 *  the dependency gate asks across, and for the same reason: a spec
 *  merged in the code repo but not in the specs repo is not merged. */
export function specRoots(ctx: SpecLookupContext, project: string): string[] {
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
  for (const [project, folders] of byProject) {
    const open = new Set<string>();
    // Kept apart from the union above (spec 220): which ROOT holds a
    // branch is what tells "waiting on a review" from "the landing did
    // not finish", and folding the roots together loses it.
    const elsewhere = new Set<string>();
    const codeRoot = ctx.machineryProjectDir(project);
    const pr = ctx.codeLanding(project) === "pr";
    // A specs root INSIDE the project is the same repository, so it
    // holds the same one branch and answers `ls-remote` identically —
    // `specRoots` asks it separately because it compares paths, not
    // repos. Counting that as a second root would call every
    // single-repo project's review a failed landing, and paceup and
    // atlasaurus are both shaped that way.
    const separate = (root: string): boolean =>
      root !== codeRoot && !resolve(root).startsWith(resolve(codeRoot) + sep);
    for (const root of specRoots(ctx, project)) {
      // A root nobody has asked about yet peeks `null`, and `?? []`
      // makes it contribute nothing — the same way an unanswerable
      // one already did. That is what keeps this failing closed
      // without any new logic to get wrong.
      for (const branch of ctx.branchStatus.peekOpenSpecBranches(root).open ?? []) {
        open.add(branch);
        if (separate(root)) elsewhere.add(branch);
      }
    }
    for (const folder of folders) {
      const branch = specBranch(folder);
      if (!open.has(branch)) continue;
      found.push(`${project}/${folder}`);
      if (pr && !elsewhere.has(branch)) reviewing.push(`${project}/${folder}`);
    }
  }
  return { unlanded: found, prOpen: reviewing };
}

/** When the set was last taken, for the archive page's own label: an
 *  answer this old is SHOWN with its age rather than withheld, the
 *  same treatment `driftNote` gives the commits-behind count. The
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
 *  (spec 163). Through the same 5-second scan `specDir` goes through,
 *  and unlike `targets()` it answers for an archived spec too. */
export function specRef(ctx: SpecLookupContext, project: string, specFolder: string): SpecRef | undefined {
  ctx.targets();
  return ctx.readScan()?.refs.get(`${project}/${specFolder}`);
}

/** What a spec's `Depends on:` line RESOLVES to, folder by folder
 *  (spec 174) — which boxes the Edit page's picker ticks.
 *
 *  Through `resolveDependencyFolder`, the same reader the save route
 *  and the runtime gate use, because the line is written by hand as
 *  often as by the page and `164` is what a person types. An
 *  identifier nothing matches simply ticks nothing: this is a form
 *  being drawn, not a run being gated, and the refusal for a typo
 *  belongs to Save and to `aide-run-spec`.
 *
 *  Not `targets()`: an entry may name an already-archived spec, which
 *  that scan drops. Such an entry ticks no box either — the picker
 *  offers live specs only — but it must not be mistaken for one that
 *  resolves to a live one. */
export function dependencyFolders(ctx: SpecLookupContext, project: string, dir: string): string[] {
  const ids = specDependsOn(dir);
  if (ids.length === 0 || !ctx.projectRoot) return [];
  const discovered = discoverProjects(ctx.projectRoot).find((p) => p.name === project);
  if (!discovered) return [];
  return ids.flatMap((id) => {
    const dep = resolveDependencyFolder(discovered, id);
    return dep && !dep.archived ? [dep.folder] : [];
  });
}

/** The checkout a spec folder sits in — the lock key for everything
 *  that touches the specs repository (spec 162).
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
 *  (spec 205). Save COMMITS and PUSHES, and Update merges — all three
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

/** The same translation, without ever awaiting a clone (spec 208).
 *
 *  `ensureCheckout` is started at boot for every allowed project, but
 *  a clone of this very repo measured 4.3 s (spec 205's own analysis)
 *  — so a spec page opened during the first minutes of a restart
 *  joined that promise and held the reader for its whole duration,
 *  showing the OLD page unchanged while it did. That is the literal
 *  shape of "the app answers at once and never waits on git" stated
 *  as a bug.
 *
 *  So "not made yet" now behaves exactly as "cannot be made" already
 *  did: fall back to the person's own folder, which is what every
 *  project used before spec 205 existed and what a project the
 *  dashboard cannot clone still uses. The clone goes on in the
 *  background and the next view reads through it.
 *
 *  READ paths only, and only the ones with no form on them.
 *  `machinerySpecDir` is untouched and its other callers still await:
 *  the spec page's own Description TAB (spec 212, where `/edit` used
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
