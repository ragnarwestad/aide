// /specs/<id>: one job, in full (spec 02). Its four parts — what the
// job is, what is happening now, what it has been doing, what it has
// run — sit behind tabs, because under plain headings they ran together
// and a reader scrolled past the one they came for.

import { esc, relTime, usdOrTokens } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { branchActivity, stateChip, unmergedBadge, type QueueRowView } from "./job-state.ts";
import { filterPills, pips, rowMessage, stepLabel, type PipKind } from "./components.ts";

export interface JobStepResultView {
  step?: string;
  ok: boolean;
  costUsd: number;
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

export interface JobLiveView {
  state: string;
  subagents: number | null;
  costUsd: number | null;
  /** What the session has metered so far, when whoever is watching it
   *  can say. claude-usage reports a cost and no token count, so this is
   *  absent in practice today and the row shows a dash in token mode —
   *  which is the honest answer for a figure nobody has, and the row
   *  flips with every other one rather than staying stubbornly in
   *  dollars. */
  tokens?: number | null;
  /** False when claude-usage could not be reached at all — the page says
   *  "unknown" rather than pretending the run is idle. */
  enriched: boolean;
}

export interface JobDetailView extends QueueRowView {
  /** The spec's H1 and its `## Description` prose. */
  title?: string;
  description?: string;
  finishedAt?: string;
  sessionId?: string;
  results: JobStepResultView[];
  /** The running step's session, when there is one to look up. */
  live?: JobLiveView | null;
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

function stepResults(results: JobStepResultView[], archiveHeldBack?: string): string {
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
        `<td class="num">${usdOrTokens(r.costUsd, r.tokens)}` +
        `${r.costMeasured ? "" : ' <span class="muted small">est.</span>'}</td>` +
        `<td>${esc(r.terminalReason)}</td>` +
        `<td class="muted small">${esc(r.sessionId ? r.sessionId.slice(0, 8) : "–")}</td>` +
        `<td class="muted small">${esc(r.at)}</td></tr>`,
    )
    .join("");
  return (
    `<table><thead><tr><th>Step</th><th>Outcome</th>` +
    `<th class="num">${unitLabel("Cost", "Tokens")}</th>` +
    `<th>Ended as</th><th>Session</th><th>At</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

// The page's tabs. The choice lives in the URL, not in script: the page
// reloads itself every 10 seconds, and a tab held only in memory would
// snap back to the first one on every reload.
const JOB_TABS = ["overview", "activity", "steps"] as const;
export type JobTab = (typeof JOB_TABS)[number];

// While a step is running, what it is DOING is what the page was
// opened for; a job that has stopped has nothing running, so its facts
// open instead.
function jobTab(name: string | undefined, job: JobDetailView): JobTab {
  if ((JOB_TABS as readonly string[]).includes(name ?? "")) return name as JobTab;
  return job.state === "running" ? "activity" : "overview";
}

function tabBar(job: JobDetailView, current: JobTab): string {
  const counts: Record<string, number> = {
    activity: job.activity?.length ?? 0,
    steps: job.results.length,
  };
  // The same pill the list's filters are: one control, one look. The
  // count rides in the label — "Activity · 12" — rather than in a badge
  // sitting on it, because it is part of the sentence.
  return filterPills(
    "tab",
    "Job",
    JOB_TABS.map((t) => ({
      label: t[0]!.toUpperCase() + t.slice(1),
      count: counts[t] ? counts[t] : undefined,
      on: t === current,
      href: `/specs/${esc(job.id)}?tab=${t}`,
    })),
    "page",
  );
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
  const tab = jobTab(opts.tab, job);
  const progress = pips(
    job.steps.map((s, i) => ({
      kind: (i < job.stepIndex ? "past" : i === job.stepIndex ? "now" : "todo") as PipKind,
      title: stepLabel(s),
    })),
  );
  const step = job.steps[job.stepIndex] ?? job.steps[job.steps.length - 1] ?? "–";

  // State and title stay ABOVE the tabs: whichever tab is open, the
  // reader still needs to know which job this is and how it is doing.
  const banner =
    `<p class="pagehead">${stateChip(job)}` +
    (job.error ? ` <span class="muted small">${esc(job.error)}</span>` : "") +
    `</p>` +
    (job.title ? `<p class="desc"><strong>${esc(job.title)}</strong></p>` : "");

  const head =
    (job.description ? `<p class="desc specdesc">${esc(job.description)}</p>` : "") +
    labelled([
      ["Project", esc(job.project)],
      ["Spec", esc(job.specFolder)],
      ["Step", `${esc(stepLabel(step))}${progress}`],
      ["Model", esc(job.model ?? "as configured")],
      [unitLabel("Cost so far", "Tokens so far"), usdOrTokens(job.spentUsd, job.spentTokens)],
      ["Started", relTime(job.startedAt ?? job.createdAt, now)],
      // One line per repo. A job that touched two repositories made a
      // branch of the same name in both, with different contents and
      // two separate compare pages — so each is named, linked and
      // badged on its own. A one-repo job renders the same way, with a
      // list of one.
      ...(job.branchUrls?.length
        ? ([
            [
              "Work",
              job.branchUrls
                .map(
                  (b) =>
                    `<div class="branch"><span class="muted small">${esc(b.label)}</span> ` +
                    `<a href="${esc(b.url)}">${esc(b.url)}</a>` +
                    // The same pair as on the row: compare, then try.
                    (b.previewUrl
                      ? ` <a class="small" href="${esc(b.previewUrl)}" ` +
                        `title="open this branch's own build">preview</a>`
                      : "") +
                    `${unmergedBadge(b, branchActivity(job))}</div>`,
                )
                .join(""),
            ],
          ] as [string, string][])
        : []),
    ]);

  // Only while a step is actually running: a finished job has no session
  // to follow, and a panel that still showed one would read as "working".
  const live =
    job.state !== "running"
      ? ""
      : `<h2>Live right now</h2>` +
        (job.live
          ? labelled([
              ["State", esc(job.live.state)],
              ["Subagents", job.live.subagents === null ? "–" : String(job.live.subagents)],
              [unitLabel("Cost so far", "Tokens so far"), usdOrTokens(job.live.costUsd, job.live.tokens)],
              ["Session", esc(job.sessionId ? job.sessionId.slice(0, 8) : "–")],
            ]) +
            (job.live.enriched
              ? ""
              : `<p class="muted small">claude-usage is unreachable — liveness, subagents and cost are unknown right now.</p>`)
          : `<p class="muted">unknown — no session is linked to this step yet.</p>`);

  // A run the runner REFUSED never started claude, so there is no
  // transcript and never will be. "Nothing has been captured" reads as
  // a lost transcript; the reader opened this tab to find out what
  // happened, so say what happened.
  const refused = job.results.some((r) => r.terminalReason === "refused");
  const activity =
    job.activity && job.activity.length > 0
      ? `<ul class="activity">${job.activity.map((a) => `<li>${a}</li>`).join("")}</ul>`
      : refused
        ? `<p class="muted">This run was refused before it started, so nothing ran and ` +
          `no transcript exists.</p>` +
          (job.error ? rowMessage("err", job.error, { hook: "refusal", tag: "p" }) : "")
        : `<p class="muted">Nothing has been captured from this run yet.</p>`;

  const panel =
    tab === "activity"
      ? activity
      : tab === "steps"
        ? stepResults(job.results, job.archiveHeldBack)
        : head + live;

  const body =
    `<p class="intro"><a href="/">← all jobs</a></p>\n` +
    banner +
    tabBar(job, tab) +
    `<div class="tabpanel">${panel}</div>`;

  // `/`, not this page's own address: the nav entry it belongs under is
  // the spec list, and that is where the list lives now.
  return pageShell(job.specFolder, entries, "/", body, generatedAt, 10);
}
