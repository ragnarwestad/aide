// /specs/<id>: one job, in full (spec 02). Its parts — what the job is,
// what it has been doing, what it has run — sit behind tabs, because
// under plain headings they ran together and a reader scrolled past the
// one they came for.
//
// It is also where the tabbed-page machinery LIVES: the tab bar, the
// steps table (each row expanding to its own log, spec 240), the file
// panel and the frame around them are exported, and `spec-page.ts`
// calls the same functions rather than carrying copies (spec 150).
// `development.md` names the two-copies-of-one-shape problem three
// times over as this repo's own recurring cost; a second tab bar would
// have been the fourth.

import { esc, relTime, usdOrTokens } from "../ui/html.ts";
import { renderSentence } from "../../i18n/message.ts";
import type { Language } from "../../i18n";
import { pageShell, type NavEntry } from "../ui/shell.ts";
import { completedThirds, stateChip, type QueueRowView } from "../ui/job-state.ts";
import { heldBackReasonText } from "../ui/job-state/notice.ts";
import { backLink, CHECKING, ICON_CHEVRON, pips, stepLabel, type PipKind } from "../ui/components.ts";

export interface JobStepResultView {
  step?: string;
  ok: boolean;
  costUsd: number;
  /** Which CLI ran this step (spec 125). Absent means claude — every
   *  result written before the second tool existed says nothing here,
   *  and claude is what ran it. `none` is a `create` step that skipped
   *  the AI session entirely (spec 433). */
  tool?: "claude" | "codex" | "fake-claude" | "none";
  /** This step's token total, absent when the run did not measure one
   *  (spec 118). A number, like the list's own view: the page shows a
   *  compact total, not the stored split. */
  tokens?: number;
  costMeasured: boolean;
  terminalReason: string;
  subtype?: string;
  sessionId?: string;
  /** Absent while this step's own work is still landing (spec 395) — see
   *  `StepResult.at`, the field this is built from. */
  at?: string;
  /** This step's OWN transcript, already-escaped (spec 240) — read from
   *  its own `streamFile` (`queue.ts:143`), never the job's live
   *  pointer. Absent when the step wrote no transcript of its own (a
   *  refused run, or one older than the field existing). */
  logs?: string[];
  /** Which attempt (job) ran this step, oldest = 1 (spec 242). Absent
   *  when the spec this row belongs to has only ever run once — nothing
   *  to disambiguate, so nothing is drawn. This page's own single-job
   *  table never sets this; only `spec-page.ts`'s flattened, multi-job
   *  Steps tab does. */
  attempt?: number;
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
   *  means claude. `none` is a finished `create` step that skipped the
   *  AI session entirely (spec 433) — never a step actually IN FLIGHT,
   *  since a running step's tool always names a real CLI (`runningStep`
   *  is resolved from the config's own model choice, which has no "none"
   *  entry). */
  tool?: "claude" | "codex" | "fake-claude" | "none";
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
  /** Why the spec's archive run did not move the folder (spec 108).
   *  Read off the SPEC's `4-status.md`, exactly as the list's row reads
   *  it, so the two pages cannot word the same fact differently. */
  archiveHeldBack?: string;
  /** The step running RIGHT NOW, when one is (spec 240). It has no
   *  `JobStepResultView` yet — a step only gets one when it ends — so
   *  it cannot live in `results`, and its transcript is the job's own
   *  live pointer, not a finished step's file. */
  runningStep?: { step: string; sessionId?: string; logs: string[]; attempt?: number };
  /** Where "← Back" goes (spec 252) — resolved by `serve.ts` from the
   *  request's own `Referer`, same-origin only. Absent falls back to
   *  `/`, today's exact hardcoded destination. */
  backHref?: string;
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
function outcome(r: JobStepResultView, archiveHeldBack?: string, landingRefused?: LandingRefusal, lang: Language = "en"): string {
  if (r.step === "archive" && r.ok && archiveHeldBack) {
    return `held back — ${esc(heldBackReasonText(lang, archiveHeldBack))}`;
  }
  // Spec 433: a create step that skipped the AI session reads distinctly
  // from an AI-run one, so a reader can tell which of the two paths
  // create took.
  if (r.step === "create" && r.ok && r.tool === "none") return "created (no AI)";
  // The step's own process exited fine — that is all `ok` records — and
  // the merge that followed it was refused. A cell reading "ok" there
  // tells the reader the opposite of what the row on the specs list
  // says, so this one says the same thing that one does.
  if (landingRefused && r.step === landingRefused.step && r.ok) return esc(landingRefused.word);
  return r.ok ? "ok" : esc(r.terminalReason || "failed");
}

/** A step whose own run finished and whose MERGE was then refused: which
 *  step it was, the short word for its Outcome cell, and what the
 *  refusal said — the sentence and, when the project's tests are what
 *  refused it, the lines naming the tests that failed.
 *
 *  Read off the job the page is already showing (`landingError` names
 *  the step, `errorReason` says whether the tests were what stopped it),
 *  so nothing new is plumbed through to reach it. */
export interface LandingRefusal {
  step: string;
  word: string;
  detail?: string;
}

export function landingRefusal(
  job: { landingError?: unknown; errorReason?: string; errorDetail?: string },
  lang: Language,
): LandingRefusal | undefined {
  const e = job.landingError;
  if (!e || typeof e !== "object" || Array.isArray(e)) return undefined;
  const step = (e as { values?: Record<string, unknown> }).values?.step;
  if (typeof step !== "string" || !step) return undefined;
  const sentence = renderSentence(lang, e as never) ?? "";
  return {
    step,
    // "stopped" is the landing's own word for a merge the project's
    // tests refused: the step ran and the merge was built, and what is
    // missing is a green suite. Everything else is a failure.
    word: job.errorReason === "tests-red" ? "merge stopped" : "merge failed",
    detail: [sentence, job.errorDetail].filter(Boolean).join("\n") || undefined,
  };
}

/** Which row a Steps tab has open, from the raw `step=` query value and
 *  whether a step is running right now (spec 240). `"none"` is an
 *  explicit close — the one value a click actually sends to collapse a
 *  row that defaulted open — and is kept apart from "absent": nothing
 *  in the URL defaults to the running row when there is one, exactly
 *  the behaviour `activityPanel` gave a live job before it existed. This
 *  is what survives the page's own 10-second reload: the open row is a
 *  property of the URL, never of a client-only widget (`queue-list.ts`'s
 *  row-fold already rejected `<details>` for the identical reason). */
export function resolveOpenStep(query: string | undefined, hasRunning: boolean): string | undefined {
  if (query === "none") return undefined;
  if (query !== undefined) return query;
  return hasRunning ? "live" : undefined;
}

/** What a step row's expanded panel shows: its own transcript, or —
 *  when it has none — why not. Subsumes `activityPanel`'s one sentence
 *  for a run the runner refused before it started; every other note
 *  that function carried is already said elsewhere (`job.error` in the
 *  banner, `archiveHeldBack` in this same row's Outcome cell). */
function stepLogPanel(logs: string[] | undefined, terminalReason: string, refusal?: string): string {
  // The merge's own refusal first: it is the newest thing that happened
  // to this step, and the transcript below it is of the run that
  // succeeded. Without it the page showed four steps reading "ok" and
  // no sign of the tests that refused the merge.
  const merge = refusal ? `<pre class="specfile">${esc(refusal)}</pre>` : "";
  if (logs && logs.length > 0) return `${merge}<pre class="specfile">${logs.join("\n")}</pre>`;
  if (merge) return merge;
  if (terminalReason === "refused") {
    return (
      `<p class="muted">This step was refused before it started, so nothing ran and ` +
      `no transcript exists.</p>`
    );
  }
  return `<p class="muted">Nothing has been captured from this step.</p>`;
}

/** Exported since spec 150: the SPEC page's Steps tab is the lead job's
 *  own, and two copies of this table would be a fourth instance of the
 *  hand-paired-lists problem `development.md` already names three times
 *  over. A spec with no job at all renders through the same empty case
 *  an empty job does.
 *
 *  Since spec 240 this is also where the Activity tab's one job lives:
 *  each row expands to ITS OWN transcript (`r.logs`, read from that
 *  step's own `streamFile` rather than the job's last one), and a step
 *  currently running gets a row of its own — `opts.runningStep` — since
 *  it has no `JobStepResultView` yet. `opts.tabHref` is absent only for
 *  a caller that wants the bare table with no expand control at all
 *  (`responsive.test.ts`'s wrap check, which asserts markup nothing
 *  here changes). `opts.mark` (spec 360) is the spec page's own "(?)"
 *  help popover, appended inside this table's own first line — this
 *  page draws none of its own, so it stays absent here. */
export function stepResults(
  results: JobStepResultView[],
  archiveHeldBack?: string,
  opts: {
    tabHref?: string;
    openStep?: string;
    runningStep?: JobDetailView["runningStep"];
    mark?: string;
    landingRefused?: LandingRefusal;
    lang?: Language;
  } = {},
): string {
  const lang: Language = opts.lang ?? "en";
  // The list shows one line per SPEC, and attributes a job to the single
  // step it is on — so a three-step job's finished steps are invisible
  // there, even though every one of them is recorded with its cost, its
  // session and how it ended.
  if (results.length === 0 && !opts.runningStep)
    return `<p class="muted">No step has finished yet.${opts.mark ? ` ${opts.mark}` : ""}</p>`;
  const open = resolveOpenStep(opts.openStep, !!opts.runningStep);
  // The chevron toggles; the name beside it is plain text — the same
  // split the specs list's own `.fold` uses, rather than making the
  // whole name the click target the way this used to (spec 240,
  // adjusted 2026-08-25): a name with no visible affordance read as
  // plain text with a hover underline, not as something to press.
  const stepCell = (label: string, key: string, isOpen: boolean): string =>
    opts.tabHref
      ? `<a class="fold steplink${isOpen ? "" : " shut"}" data-nav ` +
        `href="${opts.tabHref}&step=${isOpen ? "none" : esc(key)}" ` +
        `aria-expanded="${isOpen ? "true" : "false"}" ` +
        `title="${isOpen ? "hide" : "show"} this step's own log">${ICON_CHEVRON}</a> ${esc(label)}`
      : esc(label);
  const rows = results
    .map((r, i) => {
      const key = String(i);
      const isOpen = open === key;
      const main =
        `<tr><td>${r.attempt === undefined ? "" : `<span class="muted small">Attempt ${r.attempt}</span> `}` +
        `${stepCell(r.step ? stepLabel(r.step) : "–", key, isOpen)}</td>` +
        `<td>${outcome(r, archiveHeldBack, opts.landingRefused, lang)}</td>` +
        // A Codex step has no dollar figure ANYWHERE in its output, so
        // the money half is a dash rather than the $0.00 its stored
        // zero would print — and there is no estimate to mark either,
        // because nothing was estimated (spec 125).
        `<td class="num">${usdOrTokens(r.tool === "codex" ? undefined : r.costUsd, r.tokens)}` +
        `${r.tool === "codex" || r.costMeasured ? "" : ' <span class="muted small">est.</span>'}</td>` +
        `<td>${esc(r.terminalReason)}</td>` +
        `<td class="muted small">${esc(r.sessionId ? r.sessionId.slice(0, 8) : "–")}</td>` +
        `<td class="muted small">${r.at ? esc(r.at) : "–"}</td></tr>`;
      const log = isOpen
        ? `<tr class="steplog"><td colspan="6">${stepLogPanel(
            r.logs,
            r.terminalReason,
            opts.landingRefused && r.step === opts.landingRefused.step ? opts.landingRefused.detail : undefined,
          )}</td></tr>`
        : "";
      return main + log;
    })
    .join("");
  const runningRow = ((): string => {
    if (!opts.runningStep) return "";
    const isOpen = open === "live";
    const main =
      `<tr><td>${opts.runningStep.attempt === undefined ? "" : `<span class="muted small">Attempt ${opts.runningStep.attempt}</span> `}` +
      `${stepCell(stepLabel(opts.runningStep.step), "live", isOpen)}</td>` +
      `<td>running</td><td class="num">${usdOrTokens(undefined, undefined)}</td><td>–</td>` +
      `<td class="muted small">${esc(opts.runningStep.sessionId ? opts.runningStep.sessionId.slice(0, 8) : "–")}</td>` +
      `<td class="muted small">–</td></tr>`;
    const log = isOpen
      ? `<tr class="steplog"><td colspan="6">${stepLogPanel(opts.runningStep.logs, "")}</td></tr>`
      : "";
    return main + log;
  })();
  // Six columns of names, figures and timestamps: wider than a phone
  // whatever it is told, so the box scrolls rather than the page
  // (spec 155). The spec page's Steps tab is this same table.
  return (
    `<div class="tablewrap"><table><thead><tr><th>Step</th><th>Outcome</th>` +
    `<th class="num">${unitLabel("Cost", "Tokens")}</th>` +
    `<th>Ended as</th><th>Session</th><th>At${opts.mark ?? ""}</th></tr></thead><tbody>${rows}${runningRow}</tbody></table></div>`
  );
}

// The page's tabs. The choice lives in the URL, not in script: the page
// reloads itself every 10 seconds, and a tab held only in memory would
// snap back to the first one on every reload.
export const JOB_TABS = ["overview", "steps"] as const;
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

/** A tab's key is its route (`?tab=steps`) and everywhere else it is
 *  read as data, so renaming it would ripple into the query string, the
 *  `JobTab`/`SpecTab` types and every test asserting on either. The
 *  VISIBLE word only needed to change once — "Steps" sat directly beside
 *  "Status" on the spec page, and a phase's own task table lives under
 *  Status, so two tabs both readable as "the steps" was the confusion
 *  (raised 2026-08-25). "steps" is still exactly the right word for what
 *  the tab CONTAINS — one row per workflow step — so only the label a
 *  reader sees changes, not the concept. */
const TAB_LABELS: Record<string, string> = { steps: "Logs" };

/** The tab bar, over a BASE PATH rather than a job (spec 150). It used
 *  to build its hrefs from `job.id`, which is the one assumption a
 *  spec-scoped page could not share — and copying the bar into the new
 *  page would have been two renderings of "Logs (12)" that nothing
 *  keeps in step. */
export function tabBar<T extends string>(
  tabs: readonly T[],
  basePath: string,
  current: T,
  /** How much is behind a tab, for the tabs that have a figure at all.
   *  Partial rather than one entry per tab: Description, Analysis,
   *  Solution and Status count nothing, and a tab with no entry renders
   *  its label with no `(N)` suffix — exactly as Activity already did
   *  for a job that had captured nothing, before spec 240 folded it into
   *  this same tab. */
  counts: Partial<Record<T, number>>,
  /** Extra markup at the row's right end — a spec's own Reopen/Reset/
   *  Update (spec 300), right-aligned by the shared ".row" class.
   *  Absent for every caller but the spec page. */
  trailing = "",
): string {
  // A real tab bar, the same one the site's own two tabs are: the row
  // sits ON a hairline and the open tab is marked by an underline in
  // the accent colour, PaceUp's tab bar being the reference. It was a
  // row of filter pills with a caption — "Spec" — beside it until
  // 2026-08-23: these are pages, not a filter over one page, and a
  // caption saying which kind of thing you are already looking at said
  // nothing. Chips are for choosing among values; tabs are for moving
  // between views, and the page has both.
  //
  // The count rides in the label — "Logs (12)" — rather than in a
  // badge sitting on it, because it is part of the sentence.
  return (
    `<nav class="tabbar subtabs">` +
    tabs
      .map((t) => {
        const label = TAB_LABELS[t] ?? t[0]!.toUpperCase() + t.slice(1);
        const n = counts[t] || undefined;
        return (
          // data-goto (spec 312): a real page load, same as the top
          // row's own tabs (shell.ts) — nav-busy.ts marks it waiting.
          `<a class="tab" data-nav data-goto href="${esc(basePath)}?tab=${t}"` +
          `${t === current ? ` aria-current="page"` : ""}>` +
          `${esc(label)}${n === undefined ? "" : ` (${n})`}</a>`
        );
      })
      .join("") +
    (trailing ? `<span class="row">${trailing}</span>` : "") +
    `</nav>`
  );
}

/** The frame a tabbed page sits in: the way back, then the banner, the
 *  tabs, and whatever the open tab holds. Shared with `spec-page.ts`
 *  (spec 150) so the last three literals the two pages had in common
 *  are written once — the panels themselves already are.
 *
 *  `backHref` is resolved by the server, from the request's own
 *  `Referer` (spec 252) — this layer only draws it. */
export function tabbedBody(
  banner: string, tabs: string, panel: string, backHref: string, title?: string,
  /** True for a page whose content is FIELDS: they cap themselves at a
   *  reading width narrower than `.doc`'s own, and the wrapper takes
   *  theirs so the page has one right edge. A page of tables — this
   *  one, Projects — keeps the wider default. */
  formFields = false,
  /** Drawn at the far end of the title's own line. */
  headTrailing = "",
): string {
  // One wrapper, one right edge: the head line's buttons used to sit at
  // the frame's width while the open tab's text stopped well short of
  // it (2026-08-23).
  return (
    // Both spellings written out rather than built by hand: the class
    // guard reads the literal the class attribute holds, and a ternary
    // in there is a class name it cannot check
    // (css-guard-class-vocabulary).
    (formFields ? `<div class="doc formdoc">` : `<div class="doc">`) +
    backLink(backHref, title, headTrailing) +
    banner +
    tabs +
    `<div class="tabpanel">${panel}</div>` +
    `</div>`
  );
}

/** One spec file, preformatted and escaped, under its own name and —
 *  when somebody asked git — the commit that last changed it (spec
 *  150). Markdown is deliberately not rendered: the description put
 *  that out of scope, and a reader checking WHICH VERSION is up wants
 *  the text as written. */
export function specFilePanel(file: SpecFileView, now: number, mark = ""): string {
  return (
    `<h2>${esc(file.label)}${fileStamp(file, now)}${mark}</h2>` +
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

// Server-rendered in the site's layout. Poll-and-refresh like every
// other page here — no new transport for one panel.
export function renderJobDetailPage(
  job: JobDetailView,
  generatedAt: string,
  entries: NavEntry[],
  opts: { tab?: string; step?: string; now?: number; lang?: Language } = {},
): string {
  const now = opts.now ?? Date.now();
  const lang: Language = opts.lang ?? "en";
  // While a step is running, what it is DOING is what the page was
  // opened for; a job that has stopped has nothing running, so its
  // facts open instead. Activity is gone (spec 240) — Steps is the one
  // tab left that shows a live step.
  const tab = pickTab(JOB_TABS, opts.tab, job.state === "running" ? "steps" : "overview");
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
    `<p class="pagehead">${stateChip(job, lang)}` +
    (job.error ? ` <span class="muted small">${esc(renderSentence(lang, job.error) ?? "")}</span>` : "") +
    `</p>` +
    progress +
    (job.title ? `<p class="desc"><strong>${esc(job.title)}</strong></p>` : "");

  // Two facts, and only two (spec 150). Project and Spec are in the
  // heading, and Step is in the pips beside the state chip. What is left
  // is what this page is the only place for.
  //
  // "Live right now" was under them and is gone outright. It existed for
  // the one moment a step is running and answered `State not-live ·
  // Subagents – · Cost so far – · Session decc8861` for spec 149's
  // implement step: claude-usage does not recognise a session run in a
  // worktree under `~/aide-dashboard/worktrees/`, which is where every run has
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
          (job.results.some((r) => !r.costMeasured)
            ? ' <span class="muted small">est.</span>'
            : ""),
      ],
      ["Model", esc(job.model ?? "as configured")],
      // Spec 364, REQ-5: beside Model, on the same terms — added during
      // plan review so this page does not show Model with no Effort
      // beside it for a step that ran with one.
      ["Effort", esc(job.effort ?? "not set")],
    ]) +
    // And what this phase MADE. A reader opens a phase's page to find
    // out what that phase did, and it used to show the same
    // `## Description` prose every other page showed.
    (job.phase ? specFilePanel(job.phase, now) : "");

  const tabHref = `/specs/${esc(job.id)}?tab=steps`;
  const panel =
    tab === "steps"
      ? stepResults(job.results, job.archiveHeldBack, {
          tabHref,
          openStep: opts.step,
          runningStep: job.runningStep,
          landingRefused: landingRefusal(job, lang),
          lang,
        })
      : head;

  const body = tabbedBody(
    banner,
    tabBar(JOB_TABS, `/specs/${esc(job.id)}`, tab, {
      steps: job.results.length + (job.runningStep ? 1 : 0),
    }),
    panel,
    job.backHref ?? "/",
    job.specFolder,
  );

  // `/`, not this page's own address: the nav entry it belongs under is
  // the spec list, and that is where the list lives now.
  return pageShell(job.specFolder, entries, "/", body, generatedAt, 10, { hideHeading: true, hideTabBar: true, lang });
}
