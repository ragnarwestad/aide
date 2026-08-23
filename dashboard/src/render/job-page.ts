// /specs/<id>: one job, in full (spec 02). Its parts — what the job is,
// what it has been doing, what it has run — sit behind tabs, because
// under plain headings they ran together and a reader scrolled past the
// one they came for.
//
// It is also where the tabbed-page machinery LIVES: the tab bar, the
// activity block, the steps table, the file panel and the frame around
// them are exported, and `spec-page.ts` calls the same functions rather
// than carrying copies (spec 150). `development.md` names the
// two-copies-of-one-shape problem three times over as this repo's own
// recurring cost; a second tab bar would have been the fourth.

import { esc, relTime, usdOrTokens } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { completedThirds, stateChip, type QueueRowView } from "./job-state.ts";
import { CHECKING, filterPills, pips, rowMessage, stepLabel, type PipKind } from "./components.ts";

export interface JobStepResultView {
  step?: string;
  ok: boolean;
  costUsd: number;
  /** Which CLI ran this step (spec 125). Absent means claude — every
   *  result written before the second tool existed says nothing here,
   *  and claude is what ran it. */
  tool?: "claude" | "codex";
  /** This step's token total, absent when the run did not measure one
   *  (spec 118). A number, like the list's own view: the page shows a
   *  compact total, not the stored split. */
  tokens?: number;
  costMeasured: boolean;
  terminalReason: string;
  subtype?: string;
  sessionId?: string;
  at: string;
}

/** A spec's own file, or one section of one, as it stands on disk
 *  (spec 150). Shown preformatted and escaped: rendering markdown to
 *  HTML is its own decision and was put out of scope, and seeing which
 *  version is up needs the text, not a rendering of it.
 *
 *  `text: null` is "not written yet" — three of the four files are
 *  legitimately absent halfway through the workflow, and the page says
 *  so rather than showing an empty box.
 *
 *  `sha`/`at` are the commit that last touched the file. Absent when
 *  nobody asked git: the SPEC page stamps all four, because "which
 *  version is on the screen" is the question its Update button exists
 *  for; a job page shows one file and asks git nothing. */
export interface SpecFileView {
  /** How the panel names it — a file, or a file and the one section of
   *  it being shown. */
  label: string;
  text: string | null;
  sha?: string;
  at?: string;
  /** Nobody has yet asked git which commit this file is at (spec 208).
   *  A different state from "git could not say": that one shows no
   *  stamp at all, exactly as it did before the answer was cached, and
   *  this one says so. Set only by the SPEC page, which is the one that
   *  asks. */
  checking?: boolean;
}

export interface JobDetailView extends QueueRowView {
  /** Which CLI is running (or last ran) this job's current step. Absent
   *  means claude. */
  tool?: "claude" | "codex";
  /** The spec's H1. */
  title?: string;
  finishedAt?: string;
  results: JobStepResultView[];
  /** What THIS job's step wrote (spec 150): analyze's 3-solution.md
   *  (plan and, once the reviewer routine has run, its "Plan review"
   *  section too — spec 181), implement's 4-status.md, archive's one
   *  outcome. Absent for a step that writes no file of its own — the
   *  page then shows its three facts and nothing else. */
  phase?: SpecFileView;
  /** Already-escaped lines from `parse-stream.ts`. */
  activity?: string[];
  /** Why the spec's archive run did not move the folder (spec 108).
   *  Read off the SPEC's `4-status.md`, exactly as the list's row reads
   *  it, so the two pages cannot word the same fact differently. */
  archiveHeldBack?: string;
}

/** A heading that says "Cost" above a column of token counts is the
 *  wrong word, so it flips with the figures under it — the description
 *  asked for the Cost column "(header and values)", and this is the
 *  header half. Dollar mode is byte-for-byte what it was. */
const unitLabel = (usd: string, tok: string): string =>
  `<span class="u-usd">${esc(usd)}</span><span class="u-tok">${esc(tok)}</span>`;

/** Both columns are HTML: the labels used to be escaped here, and one of
 *  them is now two spans (`unitLabel`). Every caller passes a literal or
 *  something already escaped. */
function labelled(rows: [string, string][]): string {
  return (
    `<table class="facts"><tbody>` +
    rows.map(([k, v]) => `<tr><td class="label">${k}</td><td>${v}</td></tr>`).join("") +
    `</tbody></table>`
  );
}

/** What a finished step actually DID. `ok` is the claude session's own
 *  exit status, and for archive that is not the same question: a run
 *  that read an unfinished `4-status.md` and declined to move the
 *  folder exits just as successfully as one that moved it. So the one
 *  archive row reads the spec's own reason instead — the same words the
 *  list's row shows, from the same field. */
function outcome(r: JobStepResultView, archiveHeldBack?: string): string {
  if (r.step === "archive" && r.ok && archiveHeldBack) {
    return `held back — ${esc(archiveHeldBack)}`;
  }
  return r.ok ? "ok" : esc(r.terminalReason || "failed");
}

/** Exported since spec 150: the SPEC page's Steps tab is the lead job's
 *  own, and two copies of this table would be a fourth instance of the
 *  hand-paired-lists problem `development.md` already names three times
 *  over. A spec with no job at all renders through the same empty case
 *  an empty job does. */
export function stepResults(results: JobStepResultView[], archiveHeldBack?: string): string {
  // The list shows one line per SPEC, and attributes a job to the single
  // step it is on — so a three-step job's finished steps are invisible
  // there, even though every one of them is recorded with its cost, its
  // session and how it ended.
  if (results.length === 0) return `<p class="muted">No step has finished yet.</p>`;
  const rows = results
    .map(
      (r) =>
        `<tr><td>${esc(r.step ? stepLabel(r.step) : "–")}</td>` +
        `<td>${outcome(r, archiveHeldBack)}</td>` +
        // A Codex step has no dollar figure ANYWHERE in its output, so
        // the money half is a dash rather than the $0.00 its stored
        // zero would print — and there is no estimate to mark either,
        // because nothing was estimated (spec 125).
        `<td class="num">${usdOrTokens(r.tool === "codex" ? undefined : r.costUsd, r.tokens)}` +
        `${r.tool === "codex" || r.costMeasured ? "" : ' <span class="muted small">est.</span>'}</td>` +
        `<td>${esc(r.terminalReason)}</td>` +
        `<td class="muted small">${esc(r.sessionId ? r.sessionId.slice(0, 8) : "–")}</td>` +
        `<td class="muted small">${esc(r.at)}</td></tr>`,
    )
    .join("");
  // Six columns of names, figures and timestamps: wider than a phone
  // whatever it is told, so the box scrolls rather than the page
  // (spec 155). The spec page's Steps tab is this same table.
  return (
    `<div class="tablewrap"><table><thead><tr><th>Step</th><th>Outcome</th>` +
    `<th class="num">${unitLabel("Cost", "Tokens")}</th>` +
    `<th>Ended as</th><th>Session</th><th>At</th></tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

// The page's tabs. The choice lives in the URL, not in script: the page
// reloads itself every 10 seconds, and a tab held only in memory would
// snap back to the first one on every reload.
export const JOB_TABS = ["overview", "activity", "steps"] as const;
export type JobTab = (typeof JOB_TABS)[number];

/** A tab name off the query string, or the fallback. Exported with
 *  `tabBar` below because the spec page has to reject the same rubbish
 *  against its own list — seven tabs since spec 212, where a job has
 *  three — so the list is an argument rather than this file's own. The
 *  fallback is an argument for the same reason: the spec page is about
 *  the SPEC, so it opens on the spec whatever is running. */
export function pickTab<T extends string>(
  tabs: readonly T[],
  name: string | undefined,
  fallback: T,
): T {
  return (tabs as readonly string[]).includes(name ?? "") ? (name as T) : fallback;
}

/** The tab bar, over a BASE PATH rather than a job (spec 150). It used
 *  to build its hrefs from `job.id`, which is the one assumption a
 *  spec-scoped page could not share — and copying the bar into the new
 *  page would have been two renderings of "Activity · 12" that nothing
 *  keeps in step. */
export function tabBar<T extends string>(
  tabs: readonly T[],
  basePath: string,
  current: T,
  /** How much is behind a tab, for the tabs that have a figure at all.
   *  Partial rather than one entry per tab: Description, Analysis,
   *  Solution and Status count nothing, and a tab with no entry renders
   *  its label with no `· N` suffix — exactly as Activity already does
   *  for a job that has captured nothing. */
  counts: Partial<Record<T, number>>,
  /** What the group of pills is OF. "Job" on a job's page; the spec
   *  page says "Spec", because a caption naming the wrong thing is the
   *  one part of a shared component that cannot be shared. */
  caption = "Job",
): string {
  // The same pill the list's filters are: one control, one look. The
  // count rides in the label — "Activity · 12" — rather than in a badge
  // sitting on it, because it is part of the sentence.
  return filterPills(
    "tab",
    caption,
    tabs.map((t) => ({
      label: t[0]!.toUpperCase() + t.slice(1),
      count: counts[t] || undefined,
      on: t === current,
      href: `${esc(basePath)}?tab=${t}`,
    })),
    "page",
  );
}

/** The frame a tabbed page sits in: the way back, then the banner, the
 *  tabs, and whatever the open tab holds. Shared with `spec-page.ts`
 *  (spec 150) so the last three literals the two pages had in common
 *  are written once — the panels themselves already are. */
export function tabbedBody(banner: string, tabs: string, panel: string): string {
  return (
    `<p class="intro"><a href="/">← all specs</a></p>\n` +
    banner +
    tabs +
    `<div class="tabpanel">${panel}</div>`
  );
}

/** One spec file, preformatted and escaped, under its own name and —
 *  when somebody asked git — the commit that last changed it (spec
 *  150). Markdown is deliberately not rendered: the description put
 *  that out of scope, and a reader checking WHICH VERSION is up wants
 *  the text as written. */
export function specFilePanel(file: SpecFileView, now: number): string {
  return (
    `<h2>${esc(file.label)}${fileStamp(file, now)}</h2>` +
    (file.text === null
      ? `<p class="muted">${esc(file.label)} has not been written yet.</p>`
      : `<pre class="specfile">${esc(file.text)}</pre>`)
  );
}

/** WHICH VERSION a file's panel is showing, as the heading's own
 *  suffix. Its own function since spec 212: the Description tab is a
 *  textarea rather than a `<pre>`, and it carries the same stamp for
 *  the same reason — a reader has to be able to tell what they are
 *  about to edit from what a step wrote. */
export function fileStamp(file: SpecFileView, now: number): string {
  if (file.sha && file.at) {
    return ` <span class="muted small">committed ${relTime(file.at, now)} · ${esc(file.sha.slice(0, 7))}</span>`;
  }
  // Spec 208: the page renders now and the stamp arrives on the next
  // view. It never holds the page for a `git log`.
  return file.checking ? ` <span class="muted small">${CHECKING}</span>` : "";
}

/** What the run has been doing, or why there is nothing to show. Takes
 *  the four fields it actually reads, so the spec page can pass its lead
 *  job — or, for a spec nothing has ever run, the empty shape that
 *  produces exactly the message an empty job's tab already shows. */
export function activityPanel(job: {
  activity?: string[];
  results: JobStepResultView[];
  error?: string;
  archiveHeldBack?: string;
}): string {
  // A run the runner REFUSED never started claude, so there is no
  // transcript and never will be. "Nothing has been captured" reads as
  // a lost transcript; the reader opened this tab to find out what
  // happened, so say what happened.
  const refused = job.results.some((r) => r.terminalReason === "refused");
  // Spec 143: whatever the row's panel says about this job is said here
  // too, at the end of what the run did — the phase's own page is where
  // a reader goes to find out what that phase did, and the transcript
  // otherwise ends mid-air with no word of why.
  //
  // The held-back note is the SPEC's, not the job's, so it is shown
  // only on a job that actually ran `archive` — the same gate the Steps
  // tab already applies (`outcome`). A spec whose archive has never
  // been attempted has no job and so no page to write it into; the
  // row's panel is the only place it appears.
  const archiveNotice = job.results.some((r) => r.step === "archive") ? job.archiveHeldBack : undefined;
  const trailingNotice = job.error ?? archiveNotice;
  const streamed = !!job.activity && job.activity.length > 0;
  return streamed || refused || trailingNotice
    ? (streamed
        ? `<ul class="activity">${job.activity!.map((a) => `<li>${a}</li>`).join("")}</ul>`
        : refused
          ? `<p class="muted">This run was refused before it started, so nothing ran and ` +
            `no transcript exists.</p>`
          : "") +
        // Not when the transcript's own last line already said it — the
        // summarizer reads the run, and a run that ends by reporting
        // its own refusal would otherwise say it twice.
        (trailingNotice && job.activity?.at(-1) !== trailingNotice
          ? rowMessage("err", trailingNotice, { hook: "refusal", tag: "p" })
          : "")
    : `<p class="muted">Nothing has been captured from this run yet.</p>`;
}

// Server-rendered in the site's layout. Poll-and-refresh like every
// other page here — no new transport for one panel.
export function renderJobDetailPage(
  job: JobDetailView,
  generatedAt: string,
  entries: NavEntry[],
  opts: { tab?: string; now?: number } = {},
): string {
  const now = opts.now ?? Date.now();
  // While a step is running, what it is DOING is what the page was
  // opened for; a job that has stopped has nothing running, so its
  // facts open instead.
  const tab = pickTab(JOB_TABS, opts.tab, job.state === "running" ? "activity" : "overview");
  const progress = pips(
    job.steps.map((s, i) => ({
      kind: (i < job.stepIndex ? "past" : i === job.stepIndex ? "now" : "todo") as PipKind,
      title: stepLabel(s),
      // The same fill the spec list's row shows (spec 210), off the
      // same field: this page and that row are two views of one job,
      // and a reader who opens the row must not find it saying less.
      // Only the step the job is ON, and only while it runs.
      third: i === job.stepIndex ? completedThirds(job) : undefined,
    })),
  );

  // State and title stay ABOVE the tabs: whichever tab is open, the
  // reader still needs to know which job this is and how it is doing.
  // The pips came down with the facts table's Step row (spec 150) and
  // land here, beside the state: "Step is in the pips" is why that row
  // went, so the pips have to be somewhere a reader sees them. Their own
  // block rather than inside the paragraph — `pips()` is a `<div>`.
  const banner =
    `<p class="pagehead">${stateChip(job)}` +
    (job.error ? ` <span class="muted small">${esc(job.error)}</span>` : "") +
    `</p>` +
    progress +
    (job.title ? `<p class="desc"><strong>${esc(job.title)}</strong></p>` : "");

  // Three facts, and only three (spec 150). Project and Spec are in the
  // heading, Step is in the pips beside the state chip, and Work — one
  // line per repo, with its compare and preview links — is on the row
  // this page was opened from. What is left is what this page is the
  // only place for.
  //
  // "Live right now" was under them and is gone outright. It existed for
  // the one moment a step is running and answered `State not-live ·
  // Subagents – · Cost so far – · Session decc8861` for spec 149's
  // implement step: claude-usage does not recognise a session run in a
  // worktree under `~/aide-worktrees/`, which is where every run has
  // worked since spec 91.
  const head =
    labelled([
      ["Started", relTime(job.startedAt ?? job.createdAt, now)],
      // Marked when any step summed into it was over-charged, the same
      // way the Steps tab already marks that step (spec 152). Not
      // `anyCostUnmeasured`: this page's own `JobStepResultView` is a
      // different interface, and a Codex step has no dollar figure to
      // have estimated in the first place.
      [
        unitLabel("Cost so far", "Tokens so far"),
        usdOrTokens(job.spentUsd, job.spentTokens) +
          (job.results.some((r) => r.tool !== "codex" && r.costMeasured === false)
            ? ' <span class="muted small">est.</span>'
            : ""),
      ],
      ["Model", esc(job.model ?? "as configured")],
    ]) +
    // And what this phase MADE. A reader opens a phase's page to find
    // out what that phase did, and it used to show the same
    // `## Description` prose every other page showed.
    (job.phase ? specFilePanel(job.phase, now) : "");

  const panel =
    tab === "activity"
      ? activityPanel(job)
      : tab === "steps"
        ? stepResults(job.results, job.archiveHeldBack)
        : head;

  const body = tabbedBody(
    banner,
    tabBar(JOB_TABS, `/specs/${esc(job.id)}`, tab, {
      activity: job.activity?.length ?? 0,
      steps: job.results.length,
    }),
    panel,
  );

  // `/`, not this page's own address: the nav entry it belongs under is
  // the spec list, and that is where the list lives now.
  return pageShell(job.specFolder, entries, "/", body, generatedAt, 10);
}
