// what an archived spec's row is built from: when it was archived, which steps ran, on which models, and the rows themselves.
//
// Split out of spec-views.ts 2026-09-04, where it had grown to 562
// lines; every function is unchanged and keeps its name.
import { specArchivedDate, specCloseReason, specFileText } from "../../project/discover.ts";
import { parseStatus } from "../../project/parse-status.ts";
import { specPhaseOutcome, PhaseOutcome } from "../../project/parse-phase-outcome.ts";
import { filterShowsArchived, PHASE_LINES, ArchivedSpecView } from "../../render.ts";
import { SpecViewsContext } from "../spec-views.ts";

export function archivedAt(ctx: SpecViewsContext, dir: string): { date: string | null; checking: boolean } {
  const stamped = specArchivedDate(dir);
  if (stamped) return { date: stamped, checking: false };
  // A peek since spec 208, and the same "read, never take" rule as
  // everywhere else: `refreshSpecCaches` warms exactly this question,
  // for exactly the archived specs that have no stamp on disk.
  const { at, checkedAt } = ctx.specFileCommits.peekCommitFor(dir, ".");
  // Nothing is started from here, unlike `specFileViews`: this exact
  // question is on the warmer's own sweep, for exactly the archived
  // specs that have no stamp, so `/archive` spawns nothing at all.
  if (checkedAt === null) return { date: null, checking: true };
  // The DATE, not the instant: every stamp on disk is a date, and one
  // column reading two ways is worse than either.
  return { date: at ? at.slice(0, 10) : null, checking: false };
}

/** Which steps an archived spec's own `4-status.md` CLAIMS it has had
 *  (spec 224) — what its phase lines and its pip strip are drawn from
 *  once its row is opened.
 *
 *  The file's own word, and deliberately: a LIVE row's done-set is
 *  git-verified, through the `workflowHistory` cache `withFreshness`
 *  peeks — and `refreshSpecCaches` never warms that cache for an
 *  archived spec, because doing so is the unbounded cost spec 178's
 *  plan review turned down. Reusing the live path here would read
 *  `{history: null}` for every archived row and draw "checking…" for
 *  ever, which is not a truer answer than this one, only a slower way
 *  of giving none.
 *
 *  A SECOND reader of the same file beside `archivedAt`, on the same
 *  terms: its own question, and an empty list for every way the answer
 *  can be missing. */
export function archivedSteps(dir: string): string[] {
  const status = specFileText(dir, "4-status.md");
  return status ? parseStatus(status).workflowSteps : [];
}

/** What each of this archived spec's phases actually ran on, from its
 *  own `4-status.md` (spec 244) — the model reader beside
 *  `archivedSteps`' step reader, on the same terms: the file's own
 *  claim, and an empty map for a spec that predates the line or names
 *  nothing. */
export function archivedModels(dir: string): Record<string, string> {
  const status = specFileText(dir, "4-status.md");
  return status ? parseStatus(status).stepModels : {};
}

/** What each of this archived spec's phases recorded about its OWN
 *  run (spec 245's write side, spec 247's read side) — Model, Time
 *  spent and Cost, each in the phase's own file rather than
 *  `4-status.md` alone. Beside `archivedModels` above, on the same
 *  terms: the file's own claim, an empty entry for a step whose file
 *  names nothing. */
export function archivedPhaseOutcomes(dir: string): Record<string, PhaseOutcome> {
  const result: Record<string, PhaseOutcome> = {};
  for (const step of PHASE_LINES) {
    const outcome = specPhaseOutcome(dir, step);
    if (Object.keys(outcome).length > 0) result[step] = outcome;
  }
  return result;
}

/** Every archived spec the reader's own chip asks for, as a row for
 *  the Specs list (spec 221; this built the `/archive` page until that
 *  page retired).
 *
 *  Off the scan every other lookup on this route already shares:
 *  `refs` holds what each spec IS — title, description, folder,
 *  directory — for archived and live specs alike, and `archived` holds
 *  the keys of the archived ones with the allowlist already applied.
 *  It used to walk `discoverProjects` a second time for the same
 *  answer. One flat list, unordered: the ordering, the filtering and
 *  the search are the render layer's, so there is one copy of each
 *  rule and the route has none. `description` is whole, because the
 *  search reads all of it.
 *
 *  **The state is what decides how much of this gets built, and that
 *  is the whole point.** A row costs three small file reads
 *  (`archivedAt`, the duration stamp and the steps its `4-status.md`
 *  claims — spec 224, when the row grew phase lines), aide alone archives about
 *  150 specs, and this page rebuilds itself on every change event on
 *  every open tab. A view whose chip cannot show an archived row
 *  builds nothing for one — with ONE exception, and it is spec 193's:
 *  an archived spec whose own branch is still on origin has NOT
 *  finished, and taking its row off the reading view would hide the
 *  exact failure spec 193 exists to surface. 1-description.md asks for
 *  the default chip to be today's reading view unchanged in content,
 *  and that is what this keeps. The set is `peekUnlanded()`, it is
 *  normally empty, and it is bounded by how many specs are genuinely
 *  stranded rather than by how big the archive has grown.
 *
 *  Nothing here runs git: `archivedAt` and the not-landed mark are
 *  peeks against caches a background schedule keeps warm (spec 208),
 *  exactly as `/archive` relied on. */
export function archivedSpecRows(ctx: SpecViewsContext, state: string | undefined): ArchivedSpecView[] {
  if (!ctx.projectRoot) return [];
  // Fills `scan`, and — through `peekUnlanded` below — refills
  // `unlanded`, which `resolveProject` reads to decide whether an
  // archived spec may have `archive` asked for it a second time (spec
  // 193's way out, spec 202's other half). Both are peeks and an
  // intersection in memory, never a walk, so neither is what the gate
  // below is holding back.
  ctx.targets();
  const open = new Set(ctx.peekUnlanded());
  // Filled by the same call, and read after it (spec 220): the subset
  // of `open` that is open because the project reviews its code.
  const reviewing = new Set(ctx.readPrOpen());
  const openCheckedAt = ctx.peekUnlandedCheckedAt();
  const everyOne = filterShowsArchived(state);
  const rows: ArchivedSpecView[] = [];
  const scan = ctx.readScan();
  for (const key of scan?.archived ?? []) {
    // The two marks come from one fact and mean opposite things (spec
    // 220), so the deliberate one wins outright rather than both being
    // set and the renderer picking.
    const prWaiting = reviewing.has(key);
    const notLanded = open.has(key) && !prWaiting;
    // The gate, and it is BEFORE the two file reads under it — after
    // them it would be a filter, not a gate, and would cost the
    // default view exactly what it exists to save. A PR waiting on
    // review is not the failure this gate exists to surface, so it
    // does not bypass it the way `notLanded` does.
    if (!everyOne && !notLanded) continue;
    const ref = scan?.refs.get(key);
    if (!ref) continue;
    const project = key.slice(0, key.indexOf("/"));
    const when = archivedAt(ctx, ref.dir);
    // Spec 319: the newest landing's own reason its delete failed, when
    // there is one — read off the job store rather than re-derived, so
    // this can never disagree with what `mergeBranchIntoDefault` itself
    // found. `undefined` here just means no job recorded one; the row
    // still falls through to the plain `NOT_LANDED` wording.
    const branchDeleteError = notLanded ? ctx.queue.branchDeleteErrorFor(project, ref.folder) : undefined;
    // REQ-6: the spec's own creation date, distinct from `when` above
    // (which is the ARCHIVE date, from the `git mv`). A peek, never a
    // take (spec 208's rule, held for every question on this route):
    // `refreshSpecCaches` is what warms this, never a request.
    const created = ctx.specCreatedAt.peekCreatedAtForArchived(ref.dir, ref.folder);
    rows.push({
      project,
      folder: ref.folder,
      title: ref.title ?? undefined,
      description: ref.description ?? undefined,
      archivedAt: when.date,
      dateChecking: when.checking,
      createdAt: created.createdAt ?? undefined,
      createdAtChecking: created.checkedAt === null,
      notLanded,
      notLandedCheckedAt: notLanded ? (openCheckedAt ?? undefined) : undefined,
      branchDeleteError,
      prOpen: prWaiting,
      // Off the newest job that reported one. The queue keeps two
      // hundred jobs and the archive grows past that, so an old row
      // simply has no link — the mark still says the branch is open,
      // which is the part that matters.
      prUrl: prWaiting ? ctx.queue.pullRequestFor(project, ref.folder).prUrl : undefined,
      // The row opens now (spec 224), and this is what it opens on.
      done: archivedSteps(ref.dir),
      models: archivedModels(ref.dir),
      phaseOutcomes: archivedPhaseOutcomes(ref.dir),
      // spec 406, REQ-7: off the same `SpecRef` the scan already carries
      // `closed` on — `readerGroup()` (data-model/group-builders.ts) is
      // what turns this into the row's own `CLOSED_STATE`.
      closed: ref.closed,
      closeReason: ref.closed ? (specCloseReason(ref.dir) ?? undefined) : undefined,
    });
  }
  return rows;
}

/** Spec 212: the page's own tab decides how much this has to ask git.
 *  The Description tab's form carries `1-description.md`'s commit as
 *  its guard, and that is a `git log` this page never made before —
 *  so it is made for that tab and no other. The checks' own guard is
 *  bounded the same way, by there being an open check to draw at all;
 *  the Depends-on resolution short-circuits with no git at all for a
 *  spec whose description carries no `Depends on:` line.
 *
 *  The Description tab is also the one that AWAITS the dashboard's own
 *  checkout rather than peeking (spec 205): the text in the box and
 *  the commit Save compares it against have to come out of the same
 *  checkout Save will write through, or the first edit after a restart
 *  refuses as "changed since you opened it". Every other tab keeps the
 *  peek, because a spec page must not wait on the boot-time clone
 *  (spec 208, criterion 9) — including Overview, whose checks form
 *  therefore carries a `4-status.md` sha read through whichever
 *  checkout answered. In the minutes before the clone lands that can
 *  be the person's own, and a tick drawn from it is REFUSED rather
 *  than misapplied: the guard fails safe, and a reload fixes it. */
