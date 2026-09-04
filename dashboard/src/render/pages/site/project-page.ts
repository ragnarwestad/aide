// The served project page (spec 185): drift/deploy, run readiness, and
// the schedule section.

import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import type { ProjectReadiness } from "../../../project/project-admin.ts";
import { FIELD_OWNED_CHECKS, type ProjectSettingsView } from "../../../project/project-settings.ts";
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
 *  A real `drift` still carries three further states, never collapsed
 *  into one: unchecked (`checkedAt === null`), level (`behind === 0`),
 *  and asked-but-unanswerable (`behind === null` with a real
 *  `checkedAt` — the fail-open case). The last of those draws no
 *  message and no button at all — the same silence the list's own
 *  `note` computation falls back to for it. */
function deploySection(name: string, opts: ProjectPageOptions, now: number): string {
  // Independent of `drift`/`AIDE_INSTALL_CMD` on purpose (spec 269): the
  // Serving line answers a process-vs-disk question, not a disk-vs-origin
  // one, so it belongs on the page whether or not deploy is even
  // configured here — both branches below append it.
  const servingLine = opts.serving
    ? rowMessage(
        opts.serving.current ? "info" : "waiting",
        opts.serving.current
          ? `Serving ${opts.serving.sha.slice(0, 7)} — matches this checkout.`
          : `Serving ${opts.serving.sha.slice(0, 7)}, but this checkout is now at ` +
            `${opts.serving.checkoutHead.slice(0, 7)} — the running service has not picked up the latest merge.`,
      )
    : "";
  const drift = opts.drift;
  if (!drift) {
    return rowMessage(
      "info",
      `No ${SETTING_LABELS.AIDE_INSTALL_CMD} is configured for this project, so its origin drift is not tracked here.`,
    ) + servingLine;
  }
  const behind = drift.checkedAt !== null ? drift.behind : null;
  const message =
    drift.checkedAt === null ? rowMessage("waiting", UNCHECKED_NOTE)
    : behind ? rowMessage("waiting", driftPrefix(behind, drift.checkedAt, now))
    : behind === 0 ? rowMessage("info", "This checkout is level with origin.")
    : ""; // asked, unanswerable — no claim, never a guess
  // Level with origin is not "nothing to deploy": the served process can
  // still be older than the checkout (the Serving line above says so
  // after a landing installed but, by design, did not restart). The
  // button is off only when both are current.
  const stale = !!opts.serving && !opts.serving.current;
  const button =
    behind !== null
      ? `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/deploy" class="deployform">` +
        tokenField(opts.token) +
        btn({
          label: "Deploy",
          variant: "primary",
          pending: "deploying…",
          ...(behind === 0 && !stale
            ? { disabled: true, title: "This checkout is level with origin." }
            : {}),
        }) +
        messageSlot("refused") +
        `</form>`
      : "";
  return (opts.deployError ? rowMessage("failed", opts.deployError, { hook: "refusal", tag: "p" }) : "") +
    message + button + servingLine;
}

/** The Schedule section (spec 259): each entry's name, cron expression,
 *  prompt path and next fire time. The tab itself is always present
 *  (spec 378, REQ-6) — a project with nothing scheduled says so in a
 *  sentence, rather than the tab bar changing shape from project to
 *  project. Read-only: a schedule is edited in the committed manifest,
 *  not through this form, the same way `codeLanding` is a form field but
 *  `worktreeLinks`'s SOURCE (which of the two files) is not. */
function scheduleSection(entries: readonly ScheduleEntry[]): string {
  if (entries.length === 0) return `<p class="muted">Nothing is scheduled for this project.</p>`;
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

/** The checks no settings row owns (spec 378, REQ-3) — the checkout
 *  itself is not its own repository, the specs root is not in one, the
 *  checkout cannot reach its default branch, the dashboard cannot clone
 *  it. `FIELD_OWNED_CHECKS` is filtered out here because those checks
 *  already read on their own settings row (`unifiedSettingsTable`) —
 *  one source of truth for which check belongs where, so a fact is never
 *  shown twice with two chances to disagree. */
function checkoutSection(readiness: ProjectReadiness): string {
  const checks = readiness.checks.filter((c) => !FIELD_OWNED_CHECKS.has(c.check));
  if (checks.length === 0) return "";
  return (
    `<h3>The checkout itself</h3>` +
    `<p class="muted">Fixed on the machine, not on this page.</p>` +
    checks
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

/** A one-button form that forces the one cached answer this page has —
 *  the origin-drift count the Deploy tab reads — to be re-asked (spec
 *  378, REQ-5). No script binds this form (unlike Deploy's): the plain
 *  POST/303-redirect round trip already re-asks everything the page
 *  shows, so there is nothing an in-page swap would save. */
function refreshControl(name: string, opts: ProjectPageOptions): string {
  return (
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/refresh">` +
    tokenField(opts.token) +
    btn({ label: "Refresh" }) +
    `</form>`
  );
}

/** The Config tab: the settings table, plus — since the Health tab went
 *  away (spec 378) — whether a run can start at all, and the checks no
 *  settings row owns. `readiness` is `null` where git could not be
 *  asked, which is also why both new pieces are absent then: a page
 *  cannot claim a run can or cannot start on no evidence. */
function configSection(
  settings: ProjectSettingsView,
  name: string,
  readiness: ProjectReadiness | null,
  opts: ProjectPageOptions,
): string {
  // "No file" and "a file that sets nothing" are different states, and
  // the first is the ordinary one for a project cloned onto a second
  // machine — said plainly, above the rows, so seven "not set" lines
  // have an explanation rather than reading as seven separate
  // omissions.
  const noFile = settings.hasConfigFile
    ? ""
    : rowMessage("info", "There is no .aide/config in this checkout, so nothing below was configured on this machine.");
  const summary = readiness
    ? rowMessage(
        readiness.canRun ? "info" : "failed",
        readiness.canRun ? "Nothing stops a run: this checkout is ready to run." : "A run cannot run here yet.",
      )
    : "";
  const checkout = readiness ? checkoutSection(readiness) : "";
  return (
    noFile + summary + checkout + unifiedSettingsTable(settings, name, opts.editing, opts) + refreshControl(name, opts)
  );
}

/** The page's tabs, in the order the description gives them. Default
 *  capitalization (`tabBar`'s own `t[0].toUpperCase() + t.slice(1)`)
 *  already produces the exact words wanted, so — unlike `JOB_TABS`'s
 *  `steps` → "Logs" — no label override map is needed (spec 293).
 *  Health is gone (spec 378): every check it drew now reads on Config,
 *  either on its own settings row or in the checkout-level section. */
const PROJECT_TABS = ["config", "deploy", "schedule"] as const;
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
  // Schedule is always offered (spec 378, REQ-6): a project with nothing
  // scheduled says so on its own tab, rather than the tab bar changing
  // shape from project to project.
  const visibleTabs = PROJECT_TABS.filter((t) => (t === "deploy" ? showDeploy : true));
  const tab: ProjectTab = pickTab(visibleTabs, opts.tab, "config");
  const base = projectPagePath(p.name);
  const panel =
    tab === "deploy" ? deploySection(p.name, opts, now)
    : tab === "schedule" ? scheduleSection(opts.schedule ?? [])
    : configSection(settings, p.name, readiness, opts);

  const body = tabbedBody("", tabBar(visibleTabs, base, tab, {}), panel, PROJECTS_ROUTE, p.name);
  return pageShell(p.name, nav, base, body, generatedAt, undefined, { script: opts.script, hideHeading: true });
}
