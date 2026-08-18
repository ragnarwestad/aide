// /specs/<id>: one job, in full (spec 02). Its four parts — what the
// job is, what is happening now, what it has been doing, what it has
// run — sit behind tabs, because under plain headings they ran together
// and a reader scrolled past the one they came for.

import { esc, money, relTime } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { branchActivity, stateChip, unmergedBadge, type QueueRowView } from "./job-state.ts";

export interface JobStepResultView {
  step?: string;
  ok: boolean;
  costUsd: number;
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
}

function labelled(rows: [string, string][]): string {
  return (
    `<table class="facts"><tbody>` +
    rows.map(([k, v]) => `<tr><td class="label">${esc(k)}</td><td>${v}</td></tr>`).join("") +
    `</tbody></table>`
  );
}

function stepResults(results: JobStepResultView[]): string {
  // /specs shows one line per SPEC, and attributes a job to the single
  // step it is on — so a three-step job's finished steps are invisible
  // there, even though every one of them is recorded with its cost, its
  // session and how it ended.
  if (results.length === 0) return `<p class="muted">No step has finished yet.</p>`;
  const rows = results
    .map(
      (r) =>
        `<tr><td>${esc(r.step ?? "–")}</td>` +
        `<td>${r.ok ? "ok" : esc(r.terminalReason || "failed")}</td>` +
        `<td class="num">${money(r.costUsd)}${r.costMeasured ? "" : ' <span class="muted small">est.</span>'}</td>` +
        `<td>${esc(r.terminalReason)}</td>` +
        `<td class="muted small">${esc(r.sessionId ? r.sessionId.slice(0, 8) : "–")}</td>` +
        `<td class="muted small">${esc(r.at)}</td></tr>`,
    )
    .join("");
  return (
    `<table><thead><tr><th>Step</th><th>Outcome</th><th class="num">Cost</th>` +
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
  const links = JOB_TABS.map((t) => {
    const label = t[0]!.toUpperCase() + t.slice(1);
    const n = counts[t] ?? 0;
    const count = n > 0 ? ` <span class="tabcount">${n}</span>` : "";
    const mark = t === current ? ` aria-current="page"` : "";
    return `<a href="/specs/${esc(job.id)}?tab=${t}"${mark}>${label}${count}</a>`;
  });
  return `<nav class="tabs">${links.join("")}</nav>`;
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
  const pips = job.steps
    .map((s, i) => {
      const cls = i < job.stepIndex ? "past" : i === job.stepIndex ? "now" : "todo";
      return `<span class="pip ${cls}" title="${esc(s)}"></span>`;
    })
    .join("");
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
      ["Step", `${esc(step)}<span class="pips">${pips}</span>`],
      ["Model", esc(job.model ?? "as configured")],
      ["Cost so far", money(job.spentUsd)],
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
                    `<a href="${esc(b.url)}">${esc(b.url)}</a>${unmergedBadge(b, branchActivity(job))}</div>`,
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
              ["Cost so far", money(job.live.costUsd)],
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
          (job.error ? `<p class="refusal">${esc(job.error)}</p>` : "")
        : `<p class="muted">Nothing has been captured from this run yet.</p>`;

  const panel =
    tab === "activity" ? activity : tab === "steps" ? stepResults(job.results) : head + live;

  const body =
    `<p class="intro"><a href="/specs">← all jobs</a></p>\n` +
    banner +
    tabBar(job, tab) +
    `<div class="tabpanel">${panel}</div>`;

  return pageShell(job.specFolder, entries, "/specs", body, generatedAt, 10);
}
