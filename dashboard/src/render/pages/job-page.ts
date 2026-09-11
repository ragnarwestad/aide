// /specs/<id>: one job, in full (spec 02). Its parts — what the job is,
// what it has been doing, what it has run — sit behind tabs, because
// under plain headings they ran together and a reader scrolled past the
// one they came for.
//
// Split by theme into job-page/ (split job-page.ts by theme): types.ts
// (JobStepResultView, SpecFileView, JobDetailView) and steps-table.ts
// (the steps table, each row expanding to its own log, spec 240). The
// tab-bar machinery moved out further still, to `../ui/tabs.ts`, since
// `spec-page.ts`, `schedule-page.ts` and `site/project-page.ts` all call
// the same functions rather than carrying copies (spec 150) — none of
// them a job page. Kept as a barrel at this path because most of the
// render layer imports from it.

import { esc, relTime, usdOrTokens } from "../ui/html.ts";
import { renderSentence } from "../../i18n/message.ts";
import type { Language } from "../../i18n";
import { pageShell, type NavEntry } from "../ui/shell.ts";
import { completedThirds, stateChip } from "../ui/job-state.ts";
import { CHECKING, pips, stepLabel, type PipKind } from "../ui/components.ts";
import { pickTab, tabBar, tabbedBody } from "../ui/tabs.ts";
import { landingRefusal, stepResults, unitLabel } from "./job-page/steps-table.ts";
import type { JobDetailView, SpecFileView } from "./job-page/types.ts";

export type { JobStepResultView, SpecFileView, JobDetailView } from "./job-page/types.ts";
export { landingRefusal, resolveOpenStep, stepResults, type LandingRefusal } from "./job-page/steps-table.ts";
export { pickTab, tabBar, tabbedBody } from "../ui/tabs.ts";

// The page's tabs. The choice lives in the URL, not in script: the page
// reloads itself every 10 seconds, and a tab held only in memory would
// snap back to the first one on every reload.
export const JOB_TABS = ["overview", "steps"] as const;
export type JobTab = (typeof JOB_TABS)[number];

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
  opts: { tab?: string; step?: string; now?: number; lang?: Language; currentUrl?: string } = {},
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
  return pageShell(job.specFolder, entries, "/", body, generatedAt, 10, {
    hideHeading: true,
    hideTabBar: true,
    lang,
    currentUrl: opts.currentUrl,
  });
}
