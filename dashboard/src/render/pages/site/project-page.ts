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
        ? opts.restartWaiting?.length
          ? `This checkout matches origin, but the service is still running commit ${serving!.sha.slice(0, 7)} — ` +
            `the restart is waiting for running jobs: ${opts.restartWaiting.join(", ")}.`
          : `This checkout matches origin, but the service is still running commit ${serving!.sha.slice(0, 7)}; ` +
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
