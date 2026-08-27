// The served project page (spec 185): drift/deploy, run readiness, and
// the schedule section. Split out of site.ts by theme (split site.ts
// by theme).

import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import type { ProjectReadiness } from "../../../project/project-admin.ts";
import type { ProjectSettingsView } from "../../../project/project-settings.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { backLink, btn, messageSlot, rowMessage, tokenField } from "../../ui/components.ts";
import { esc, relTimeLabel } from "../../ui/html.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { PROJECTS_ROUTE, projectPagePath } from "./routes.ts";
import { unifiedSettingsTable } from "./settings-table.ts";
import { UNCHECKED_NOTE, type ProjectPageOptions, type ProjectView } from "./types.ts";

/** The shared half of the drift sentence — one wording source, two
 *  endings (spec 258): the list's own `driftNote` in `projects-page.ts`
 *  appends " — deploy is a hand step", which would contradict the
 *  Deploy button this file draws right beside the same words. */
export const driftPrefix = (behind: number, checkedAt: number, now: number): string =>
  `${behind} ${behind === 1 ? "commit" : "commits"} behind origin, checked ` +
  `${relTimeLabel(new Date(checkedAt).toISOString(), now)}`;

/** Plainly whether this checkout is behind origin, and — only when it
 *  is, and only when a deploy step is configured — a button that brings
 *  it up to date and deploys it in one action (spec 258).
 *
 *  `drift` undefined means ungated: no `AIDE_INSTALL_CMD`. Unlike the
 *  `/projects` list — which omits an ungated project's row-note
 *  entirely, to avoid noise on every row — this page keeps the section
 *  and says plainly why there is nothing to act on.
 *
 *  A real `drift` still carries three further states, never collapsed
 *  into one: unchecked (`checkedAt === null`), level (`behind === 0`),
 *  and asked-but-unanswerable (`behind === null` with a real
 *  `checkedAt` — the fail-open case). The last of those draws no
 *  message and no button at all — the same silence the list's own
 *  `note` computation falls back to for it. */
function deploySection(name: string, opts: ProjectPageOptions, now: number): string {
  const drift = opts.drift;
  if (!drift) {
    return `<h3>Deploy</h3>` +
      rowMessage(
        "info",
        "No AIDE_INSTALL_CMD is configured for this project, so its origin drift is not tracked here.",
      );
  }
  const behind = drift.checkedAt !== null ? drift.behind : null;
  const message =
    drift.checkedAt === null ? rowMessage("warn", UNCHECKED_NOTE)
    : behind ? rowMessage("warn", driftPrefix(behind, drift.checkedAt, now))
    : behind === 0 ? rowMessage("info", "This checkout is level with origin.")
    : ""; // asked, unanswerable — no claim, never a guess
  const button = behind
    ? `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/deploy" class="deployform">` +
      tokenField(opts.token) +
      btn({ label: "Deploy", variant: "primary", pending: "deploying…" }) +
      messageSlot("refused") +
      `</form>`
    : "";
  return `<h3>Deploy</h3>` +
    (opts.deployError ? rowMessage("err", opts.deployError, { hook: "refusal", tag: "p" }) : "") +
    message + button;
}

/** The Schedule section (spec 259): each entry's name, cron expression,
 *  prompt path and next fire time. Absent entirely when the project has
 *  none — acceptance criterion 6 — so a project that has never adopted
 *  the feature shows nothing new on its page. Read-only: a schedule is
 *  edited in the committed manifest, not through this form, the same
 *  way `codeLanding` is a form field but `worktreeLinks`'s SOURCE (which
 *  of the two files) is not. */
function scheduleSection(entries: readonly ScheduleEntry[]): string {
  if (entries.length === 0) return "";
  const now = new Date();
  const rows = entries
    .map((e) => {
      const next = nextFireTime(e.cron, now);
      return (
        `<tr><td>${esc(e.name)}</td><td><code>${esc(e.cron)}</code></td>` +
        `<td>${esc(e.prompt)}</td><td>${next ? esc(next.toISOString()) : `<span class="muted">–</span>`}</td></tr>`
      );
    })
    .join("");
  return (
    `<h3>Schedule</h3>` +
    `<div class="tablewrap"><table class="list"><thead><tr><th>Name</th><th>Cron</th>` +
    `<th>Prompt</th><th>Next run</th></tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

/** The settings the config file decides, and whether a run could start
 *  here at all — the two things a project's page never said (spec 185).
 *
 *  `readiness` is `null` where git could not be asked. The section then
 *  says nothing rather than guessing: the reader came for the project's
 *  page, and an unreachable git is no reason to withhold the half of it
 *  that needs no git. */
function runConfigurationBlock(
  settings: ProjectSettingsView,
  readiness: ProjectReadiness | null,
  name: string,
  opts: ProjectPageOptions,
  now: number,
): string {
  // "No file" and "a file that sets nothing" are different states, and
  // the first is the ordinary one for a project cloned onto a second
  // machine — said plainly, above the rows, so seven "not set" lines
  // have an explanation rather than reading as seven separate
  // omissions.
  const noFile = settings.hasConfigFile
    ? ""
    : rowMessage("info", "There is no .aide/config in this checkout, so nothing below was configured on this machine.");
  const checks = !readiness
    ? ""
    : `<h3>Can a run start here?</h3>` +
      rowMessage(
        readiness.canRun ? "info" : "err",
        readiness.canRun
          ? "Nothing stops a run: this checkout is ready to run."
          : "A run cannot run here yet.",
      ) +
      readiness.checks
        .map((c) =>
          c.blocking
            ? rowMessage("err", c.detail)
            : c.ok
              ? `<p class="muted">${esc(c.detail)}</p>`
              : rowMessage("warn", c.detail),
        )
        .join("");
  return (
    `<h3>Settings</h3>` +
    noFile +
    unifiedSettingsTable(settings, name, opts.editing, opts) +
    deploySection(name, opts, now) +
    checks +
    scheduleSection(opts.schedule ?? [])
  );
}

/** The served project page: the static body, plus the settings and the
 *  readiness answer. */
export function renderProjectPage(
  p: ProjectView,
  settings: ProjectSettingsView,
  readiness: ProjectReadiness | null,
  generatedAt: string,
  nav: NavEntry[],
  opts: ProjectPageOptions,
): string {
  // The clock the drift note's freshness label is measured against —
  // the page's own stamp, the same way `renderProjectsPage` derives one
  // from `generatedAt` rather than taking a second "now" nobody asked for.
  const stamped = Date.parse(generatedAt);
  const now = Number.isNaN(stamped) ? Date.now() : stamped;
  const body = backLink(PROJECTS_ROUTE) + runConfigurationBlock(settings, readiness, p.name, opts, now);
  return pageShell(p.name, nav, projectPagePath(p.name), body, generatedAt, undefined, { script: opts.script });
}
