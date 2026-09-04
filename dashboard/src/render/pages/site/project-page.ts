// The served project page (spec 185): drift/deploy, run readiness, and
// the schedule section.

import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import type { ProjectReadiness } from "../../../project/project-admin.ts";
import type { ProjectSettingsView } from "../../../project/project-settings.ts";
import { SETTING_LABELS } from "../../../project/setting-labels.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { btn, messageSlot, rowMessage, tokenField } from "../../ui/components.ts";
import { esc, relTimeLabel } from "../../ui/html.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { pickTab, tabBar, tabbedBody } from "../job-page.ts";
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
 *  A real `drift` still carries three further states: unchecked
 *  (`checkedAt === null`), a real answer (`behind` a number), and
 *  asked-but-unanswerable (`behind === null` with a real `checkedAt` —
 *  the fail-open case, which draws no message and no button at all).
 *
 *  Once the answer is real, it is never split across two sentences
 *  (spec 377): disk-vs-origin (`drift`) and process-vs-disk (`serving`)
 *  fold into the ONE sentence the reader needs, in whichever of REQ-4's
 *  three shapes applies — up to date, behind, or installed but not
 *  restarted. `serving` is undefined for every project except the one
 *  this server itself runs from (`ProjectPageOptions.serving`), so the
 *  third shape is reachable only there; every other gated project only
 *  ever shows the first two. */
function deploySection(name: string, opts: ProjectPageOptions, now: number): string {
  const panel = (inner: string): string => (inner ? `<div class="deploypanel">${inner}</div>` : "");
  const serving = opts.serving;
  const servingLine = serving
    ? rowMessage(
        serving.current ? "info" : "waiting",
        serving.current
          ? `Serving commit ${serving.sha.slice(0, 7)} — matches this checkout.`
          : `Serving commit ${serving.sha.slice(0, 7)}, but this checkout is now at commit ` +
            `${serving.checkoutHead.slice(0, 7)} — the running service has not picked up the latest merge.`,
      )
    : "";
  const drift = opts.drift;
  if (!drift) {
    return panel(
      rowMessage(
        "info",
        `No ${SETTING_LABELS.AIDE_INSTALL_CMD} is configured for this project, so its origin drift is not tracked here.`,
      ) + servingLine,
    );
  }
  // Shown wherever `drift` is defined — the same scope the original
  // function gave it (never in the ungated branch above, which a
  // deploy press could not have been refused FROM in the first place).
  const errorLine = opts.deployError ? rowMessage("failed", opts.deployError, { hook: "refusal", tag: "p" }) : "";
  if (drift.checkedAt === null) return panel(errorLine + rowMessage("waiting", UNCHECKED_NOTE) + servingLine);
  const behind = drift.behind;
  if (behind === null) return panel(errorLine + servingLine); // asked, unanswerable — no claim, never a guess

  // From here the checkout's own drift IS known, so its answer and the
  // Serving line's answer (when there is one) fold into one sentence
  // instead of stacking as two (REQ-1, REQ-4).
  const stale = !!serving && !serving.current;
  const disabled = behind === 0 && !stale;
  const sentence =
    behind > 0
      ? `${driftPrefix(behind, drift.checkedAt, now)} — Deploy pulls ${behind === 1 ? "it" : "them"}, installs` +
        (serving ? ", and restarts the service." : ".")
      : stale
        ? `This checkout matches origin, but the service is still running commit ${serving!.sha.slice(0, 7)}; ` +
          `Deploy restarts it on commit ${serving!.checkoutHead.slice(0, 7)}.`
        : serving
          ? `This checkout matches origin, and the service is running commit ${serving.sha.slice(0, 7)}.`
          : "This checkout matches origin.";
  const button =
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/deploy" class="deployform">` +
    tokenField(opts.token) +
    btn({
      label: "Deploy",
      variant: "primary",
      pending: "deploying…",
      // The title stays the short, common half of the sentence even
      // when the up-to-date-with-serving-current case says more — a
      // hover hint names WHY the button is off, not the whole state.
      ...(disabled ? { disabled: true, title: "This checkout matches origin." } : {}),
    }) +
    messageSlot("refused") +
    `</form>`;
  return panel(errorLine + rowMessage(behind > 0 || stale ? "waiting" : "info", sentence) + button);
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
    `<div class="tablewrap"><table class="list"><thead><tr><th>Name</th><th>Cron</th>` +
    `<th>Prompt</th><th>Next run</th></tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

/** The Config tab: today's "Settings" section, renamed only — its
 *  content (the unified settings table, and the no-`.aide/config`
 *  notice above it) is unchanged (spec 293). Always present: unlike
 *  Deploy/Health/Schedule, this table renders unconditionally today
 *  regardless of whether a config file exists, so there is no "nothing
 *  to show" state for it to hide. */
function configSection(settings: ProjectSettingsView, name: string, opts: ProjectPageOptions): string {
  // "No file" and "a file that sets nothing" are different states, and
  // the first is the ordinary one for a project cloned onto a second
  // machine — said plainly, above the rows, so seven "not set" lines
  // have an explanation rather than reading as seven separate
  // omissions.
  const noFile = settings.hasConfigFile
    ? ""
    : rowMessage("info", "There is no .aide/config in this checkout, so nothing below was configured on this machine.");
  return noFile + unifiedSettingsTable(settings, name, opts.editing, opts);
}

/** The Health tab: today's "Can a run start here?" section, unchanged
 *  content (spec 293). `readiness` is `null` where git could not be
 *  asked, which is also why the Health tab itself is hidden then (see
 *  `renderProjectPage`) — this function's own empty case and the tab's
 *  visibility must agree, or a reader could pick a tab that renders
 *  nothing. */
function healthSection(readiness: ProjectReadiness | null): string {
  if (!readiness) return "";
  return (
    `<h3>Can a run start here?</h3>` +
    rowMessage(
      readiness.canRun ? "info" : "failed",
      readiness.canRun ? "Nothing stops a run: this checkout is ready to run." : "A run cannot run here yet.",
    ) +
    readiness.checks
      .map((c) =>
        c.blocking
          ? rowMessage("failed", c.detail)
          : c.ok
            ? `<p class="muted">${esc(c.detail)}</p>`
            : rowMessage("waiting", c.detail),
      )
      .join("")
  );
}

/** The page's tabs, in the order the description gives them. Default
 *  capitalization (`tabBar`'s own `t[0].toUpperCase() + t.slice(1)`)
 *  already produces the exact words wanted, so — unlike `JOB_TABS`'s
 *  `steps` → "Logs" — no label override map is needed (spec 293). */
const PROJECT_TABS = ["config", "deploy", "health", "schedule"] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

/** The served project page: the settings, the readiness answer, the
 *  deploy state and the schedule, one tab at a time (spec 293 —
 *  previously one long scroll, spec 185). */
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

  // Deploy answers two independent questions bundled onto one tab
  // (spec 269's own comment on `deploySection`): disk-vs-origin
  // (`drift`, gated on AIDE_INSTALL_CMD) and process-vs-disk
  // (`serving`, never gated — it belongs on the page "whether or not
  // deploy is even configured here"). Hiding the tab needs BOTH to
  // have nothing to say; gating on `drift` alone would also take the
  // Serving line down for the one project this dashboard process
  // itself runs from.
  const showDeploy = !!opts.drift || !!opts.serving;
  const showHealth = !!readiness;
  const showSchedule = (opts.schedule ?? []).length > 0;
  const visibleTabs = PROJECT_TABS.filter((t) =>
    t === "deploy" ? showDeploy
    : t === "health" ? showHealth
    : t === "schedule" ? showSchedule
    : true,
  );
  const tab: ProjectTab = pickTab(visibleTabs, opts.tab, "config");
  const base = projectPagePath(p.name);
  const panel =
    tab === "deploy" ? deploySection(p.name, opts, now)
    : tab === "health" ? healthSection(readiness)
    : tab === "schedule" ? scheduleSection(opts.schedule ?? [])
    : configSection(settings, p.name, opts);

  const body = tabbedBody("", tabBar(visibleTabs, base, tab, {}), panel, PROJECTS_ROUTE, p.name);
  return pageShell(p.name, nav, base, body, generatedAt, undefined, { script: opts.script, hideHeading: true });
}
