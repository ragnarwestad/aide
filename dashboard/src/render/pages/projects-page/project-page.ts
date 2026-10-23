// The served project page (spec 185): drift/deploy, run readiness, and
// the schedule section.

import type { ScheduleEntry } from "../../../queue/schedule.ts";
import type { ProjectReadiness } from "../../../project/project-admin";
import { FIELD_OWNED_CHECKS, type ProjectSettingsView } from "../../../project/project-settings.ts";
import { SETTING_LABELS } from "../../../project/setting-labels.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { askButton, btnLink, buttonForm, messageSlot, rowMessage } from "../../ui/components";
import { jobsSentence } from "../../ui/components/spec-name.ts";
import { esc, relTimeLabel } from "../../ui/html.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { t } from "../../../i18n";
import { pickTab, tabBar, tabbedBody } from "../job-page";
import { SCHEDULE_REFUSED_LINE, scheduleControlCells } from "../schedule-page/controls.ts";
import { scheduleNewPath, schedulePagePath, scheduleSettingsPath } from "../schedule-page";
import { modelFlag } from "../schedule-page/model-flag.ts";
import { SORT_DEFAULT_DIR, sortRows } from "../schedule-page/list.ts";
import { queryHref, resolveSort, sortHeading, type SortColumns } from "../schedule-page/sort-head.ts";
import { deployAskDialog, STEP_LABEL } from "./deploy-dialog.ts";
import { projectDescription } from "./overview-list.ts";
import { PROJECTS_ROUTE, projectPagePath } from "./routes.ts";
import { unifiedSettingsTable } from "./settings-table.ts";
import { reloadMarker } from "../spec-page/tabs.ts";
import type { ProjectDrift, ProjectPageOptions, ProjectView } from "./types.ts";

/** How long a Deploy tab that has no origin answer yet waits before
 *  asking for itself again. The answer is taken by a background poll,
 *  not by this render, so the only page that can be wrong is one drawn
 *  in the seconds before the first poll returns — a restart's own first
 *  page load, every time. Long enough for a `git fetch` to finish,
 *  short enough that nobody reads the stale sentence twice. */
export const AWAITING_DRIFT_REFRESH_SECONDS = 5;

/** What the Deploy tab of every project but the board's own says in place of a button. */
export const NO_DEPLOY_SENTENCE =
  "There is not enough information about how this project is deployed to offer Deploy.";

const NOT_CHECKED_SENTENCE = "Whether this checkout is behind origin has not been checked yet.";
const MATCHES_ORIGIN_SENTENCE = "This checkout matches origin.";

/** Shared by `deploySection` and `testServerSection`: the Deploy tab's own
 *  panel wrapper, empty content drawing nothing at all. */
const panel = (inner: string): string => (inner ? `<div class="deploypanel">${inner}</div>` : "");

/** The Deploy section, with the address the page script asks origin
 *  through when the tab is open (`specs-client/deploy/origin-check.ts`). */
const checked = (name: string, inner: string): string =>
  `<div data-origin-check="${esc(`/api/queue/projects/${encodeURIComponent(name)}/drift`)}">${inner}</div>`;

export const driftPrefix = (behind: number, checkedAt: number, now: number): string =>
  `${behind} ${behind === 1 ? "commit" : "commits"} behind origin, checked ` +
  `${relTimeLabel(new Date(checkedAt).toISOString(), now)}`;

/** Every project but the board's own: how far its checkout is behind
 *  origin, and one sentence saying Deploy is not offered. No button, and
 *  no claim when origin was asked and could not answer. */
function otherProjectDeploy(
  name: string,
  drift: ProjectDrift | undefined,
  now: number,
  heading: string,
  servingLine: string,
): string {
  const line = !drift
    ? ""
    : drift.checkedAt === null
      ? rowMessage("waiting", NOT_CHECKED_SENTENCE)
      : drift.behind === null
        ? "" // asked, unanswerable: no claim
        : drift.behind > 0
          ? rowMessage("waiting", `${driftPrefix(drift.behind, drift.checkedAt, now)}.`)
          : rowMessage("info", MATCHES_ORIGIN_SENTENCE);
  const inner = heading + panel(line + servingLine + rowMessage("info", NO_DEPLOY_SENTENCE));
  return drift ? checked(name, inner) : inner;
}

/** The board's own Deploy: plainly whether this checkout is behind
 *  origin, and — only when it is, and only when a deploy step is
 *  configured — a button that asks, and queues the deploy job (spec 258).
 *  Every other project is drawn by `otherProjectDeploy`.
 *
 *  `drift` undefined means ungated: no `AIDE_INSTALL_CMD`. This page keeps
 *  the section and says plainly why there is nothing to act on.
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
 *  this server itself runs from (`ProjectPageOptions.serving`). */
function deploySection(name: string, opts: ProjectPageOptions, now: number): string {
  // AC-1/AC-2: this section's own heading, so it reads apart from the
  // new "Testserver med testspecene" section beside it.
  const heading = `<h3>${esc(t(opts.lang ?? "en", "project.deployHeading"))}</h3>`;
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
  if (!opts.boardItself) return otherProjectDeploy(name, drift, now, heading, servingLine);
  if (!drift) {
    return heading + panel(
      rowMessage(
        "info",
        `No ${SETTING_LABELS.AIDE_INSTALL_CMD} is configured for this project, so its origin drift is not tracked here.`,
      ) + servingLine,
    );
  }
  // Shown wherever `drift` is defined, never in the ungated branch above.
  // The kept failure names its step, and carries `deploy-error`.
  const failure = opts.deployFailure;
  const errorLine = failure
    ? rowMessage(
        "failed",
        t(opts.lang ?? "en", "deploy.failedAt", { step: t(opts.lang ?? "en", STEP_LABEL[failure.step]!), error: failure.error }),
        { hook: "refusal deploy-error", tag: "p" },
      )
    : "";
  const notYetChecked = drift.checkedAt === null;
  const behind = drift.behind;
  // Only "asked, unanswerable" still bails out with no claim and no
  // button (REQ-5) — "never asked" now falls into the shared chain
  // below (spec 392, REQ-1, REQ-3).
  if (!notYetChecked && behind === null) return checked(name, heading + panel(errorLine + servingLine)); // asked, unanswerable — no claim, never a guess

  // From here the checkout's own drift is either known, or not yet
  // asked at all, so its answer and the Serving line's answer (when
  // there is one) fold into one sentence instead of stacking as two
  // (REQ-1, REQ-4).
  const stale = !!serving && !serving.current;
  const disabled = notYetChecked || (behind === 0 && !stale);

  // REQ-1, REQ-2, REQ-7 (spec 392): what to say about the served commit
  // when origin itself is still unknown — never a bare hash, and never
  // phrased twice (the `stale` sentence below keeps its own bare-hash
  // wording exactly as it is, per REQ-5).
  const servedCommitPhrase = (s: NonNullable<typeof serving>): string | undefined =>
    s.newestSubject === undefined
      ? undefined // git could not answer — fail open, no invented claim
      : s.current
        ? `the service is already running the newest change, "${s.newestSubject}"`
        : `the service is ${s.behindCount ?? "some"} commit${s.behindCount === 1 ? "" : "s"} behind this checkout` +
          ` — the newest change is "${s.newestSubject}"`;

  let sentenceHtml: string | undefined;
  const sentence = notYetChecked
    ? (() => {
        const phrase = serving && servedCommitPhrase(serving);
        return phrase
          ? `${NOT_CHECKED_SENTENCE.slice(0, -1)}; ${phrase}.`
          : NOT_CHECKED_SENTENCE;
      })()
    : behind! > 0
      ? `${driftPrefix(behind!, drift.checkedAt!, now)} — Deploy pulls ${behind === 1 ? "it" : "them"}, installs` +
        (serving ? ", and restarts the service." : ".")
      : stale
        ? opts.restartWaiting?.length
          ? (() => {
              const s = jobsSentence(
                opts.lang ?? "en", "project.deployRestartWaiting",
                { sha: serving!.sha.slice(0, 7) }, opts.restartWaiting!,
              );
              sentenceHtml = s.html;
              return s.text;
            })()
          : `This checkout matches origin, but the service is still running commit ${serving!.sha.slice(0, 7)}; ` +
            `Deploy restarts it on commit ${serving!.checkoutHead.slice(0, 7)}.`
        : serving
          ? `This checkout matches origin, and the service is running commit ${serving.sha.slice(0, 7)}.`
          : MATCHES_ORIGIN_SENTENCE;

  const title = notYetChecked
    ? "Origin has not been checked yet."
    : disabled
      ? MATCHES_ORIGIN_SENTENCE
      // REQ-9 (spec 392): the button stays live (a press still retries
      // the install), but hovering it says a press will not restart the
      // service sooner.
      : stale && opts.restartWaiting?.length
        ? "Pressing again only repeats the pull and install — it does not restart the service sooner."
        : undefined;

  // The board's own Deploy asks first, and OK queues the job. A second press
  // is refused while one is under way, and the hover line says so.
  const lang = opts.lang ?? "en";
  const dialogId = "deployask";
  const underWay = opts.deployUnderWay
    ? `A deploy is already ${opts.deployUnderWay} — follow it on the Running tab.`
    : undefined;
  const ask =
    askButton({ label: "Deploy", dialogId, variant: "primary", disabled, title: underWay ?? title }) +
    deployAskDialog(lang, name, dialogId);
  return checked(
    name,
    heading + panel(errorLine + rowMessage(notYetChecked || behind! > 0 || stale ? "waiting" : "info", sentence, { html: sentenceHtml }) + ask),
  );
}

/** AC-3/AC-4/AC-8: the section beside Deploy for prod — a button that
 *  starts (or, per AC-6, restarts) a test server from the latest main,
 *  seeded with the round's own test specs. Only a project that carries the
 *  dashboard's own source can start one; every other project is not told
 *  about it at all. */
function testServerSection(name: string, opts: ProjectPageOptions): string {
  if (!opts.testServerAvailable) return "";
  const lang = opts.lang ?? "en";
  const heading = `<h3>${esc(t(lang, "project.testServerHeading"))}</h3>`;
  // Deliberately NOT class="actionform"/"rowrun" — either class gets its
  // native submit replaced by an XHR
  // (`specs-client/forms.ts`/`press.ts`), which silently defeats
  // `target="_blank"` and breaks AC-5. `.deploypanel`'s own flex `gap`
  // spaces this form's children with no CSS of its own needed.
  const button = buttonForm({
    action: `/api/queue/projects/${encodeURIComponent(name)}/test-server`,
    data: { testserverform: "" },
    target: "_blank",
    button: { label: t(lang, "project.testServerButton"), variant: "primary" },
  });
  return heading + panel(rowMessage("info", t(lang, "project.testServerNote")) + button);
}

/** The columns a project's Schedule tab sorts by: the /schedule list's,
 *  less Last run, which this tab does not show. */
const SCHEDULE_TAB_SORT: SortColumns = { keys: ["name", "next", "enabled"], fallback: "name", firstDir: SORT_DEFAULT_DIR };

/** The Schedule section (spec 259, extended spec 468): each entry's
 *  name (linking to its own detail page), next fire time, its Enabled
 *  switch, Run now and Delete — what fits on one line; the rest of what
 *  an entry is set to is on its own Settings tab — and New, which makes
 *  one for THIS project. The tab itself is always present (spec 378, REQ-6) —
 *  a project with nothing scheduled says so in a sentence, rather than
 *  the tab bar changing shape from project to project.
 *
 *  The form is drawn unconditionally (AC-1) — `1-description.md`'s own
 *  wording carries no exception for a project outside the queue's
 *  allowlist. Such a project is still reachable from `/projects`
 *  (2-analysis.md, Patterns); its submission is refused by the create
 *  route's own `ctx.allowed.has(project)` check, and the refusal shows
 *  through this same form's own error line — the identical channel a
 *  bad cron or a duplicate name already uses (3-solution.md, Risk 2). */
function scheduleSection(project: string, entries: readonly ScheduleEntry[], opts: ProjectPageOptions): string {
  const lang = opts.lang ?? "en";
  const now = new Date();
  const f = opts.scheduleSort ?? {};
  const sorted = resolveSort(SCHEDULE_TAB_SORT, f);
  // The /schedule list's sortable heading, kept on this tab.
  const th = (key: string, label: string): string =>
    sortHeading(SCHEDULE_TAB_SORT, sorted, key, label, (sort, dir) =>
      queryHref(projectPagePath(project), { tab: "schedule", sort, dir }));
  const rows = sortRows(entries.map((entry) => ({ project, entry })), f, now, SCHEDULE_TAB_SORT);
  const table =
    entries.length === 0
      ? `<p class="muted">${t(lang, "schedule.nothingScheduled")}</p>`
      : `<div class="tablewrap"><table class="list"><thead><tr>${th("name", t(lang, "schedule.colName"))}` +
        th("next", t(lang, "schedule.colNextRun")) +
        // Enabled, then two unlabelled columns: Run now and Delete.
        `${th("enabled", t(lang, "schedule.enabled"))}<th></th><th></th></tr></thead><tbody>` +
        rows
          .map(({ entry: e }) => {
            const next = nextFireTime(e.cron, now);
            return (
              // The whole row, outside its controls, goes where the name
              // does (`followScheduleRow`).
              `<tr data-row-href="${esc(schedulePagePath(project, e.name))}">` +
              `<td><a href="${esc(schedulePagePath(project, e.name))}">${esc(e.name)}</a>` +
              modelFlag(lang, e.model, opts.scheduleModelNames, scheduleSettingsPath(project, e.name)) +
              `</td>` +
              `<td>${next ? esc(next.toISOString()) : `<span class="muted">–</span>`}</td>` +
              scheduleControlCells(project, e) +
              `</tr>`
            );
          })
          .join("") +
        `</tbody></table></div>`;
  // A refusal of Run now, Enabled or Delete, written here by the page
  // script (`schedule-actions.ts`, `reload-form/`).
  const slot = messageSlot("refused", "failed", { id: SCHEDULE_REFUSED_LINE });
  // New on the right of the line above the table, as Add is on the
  // Projects list.
  const top = `<div class="listtop">${btnLink({ href: scheduleNewPath(project), label: t(lang, "schedule.new"), variant: "primary" })}</div>`;
  return top + slot + table;
}

/** The checks no settings row owns that did NOT pass (spec 378, spec
 *  531) — a check that passed says nothing here; the summary line above
 *  has already said as much. `FIELD_OWNED_CHECKS` keeps this the one
 *  place a fact this page draws twice cannot disagree with itself. */
function checkoutChecks(readiness: ProjectReadiness): string {
  const checks = readiness.checks.filter((c) => !FIELD_OWNED_CHECKS.has(c.check) && !c.ok);
  return checks.map((c) => rowMessage(c.blocking ? "failed" : "waiting", c.detail)).join("");
}

/** The one line at the top of Config saying whether a run can start
 *  (spec 378) — the information card while nothing blocks it, and the
 *  board's own error card, naming every blocking reason in the same
 *  words its own check already carries, when something does (spec 531).
 *  `readiness.canRun` guarantees at least one blocking check exists in
 *  the false branch (`readiness.ts`: `canRun = checks.every(c =>
 *  !c.blocking)`). Non-blocking-but-failing checks are named in their
 *  own amber card below (`checkoutChecks`), not repeated here. */
function readinessSummary(readiness: ProjectReadiness): string {
  if (readiness.canRun) {
    return rowMessage("info", "Nothing stops a run: this checkout is ready to run.");
  }
  const reasons = readiness.checks.filter((c) => c.blocking).map((c) => c.detail);
  return rowMessage("failed", `a run cannot start here yet: ${reasons.join("; ")}`);
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
  const summary = readiness ? readinessSummary(readiness) : "";
  const checkout = readiness ? checkoutChecks(readiness) : "";
  return noFile + summary + checkout + unifiedSettingsTable(settings, name, opts.editingGroup, opts);
}

/** The page's tabs, in the order they are drawn: Deploy first. Default
 *  capitalization (`tabBar`'s own `t[0].toUpperCase() + t.slice(1)`)
 *  already produces the exact words wanted, so — unlike `JOB_TABS`'s
 *  `steps` → "Logs" — no label override map is needed (spec 293).
 *  Health is gone (spec 378): every check it drew now reads on Config,
 *  either on its own settings row or in the checkout-level section. */
const PROJECT_TABS = ["deploy", "config", "schedule"] as const;
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

  // The Deploy tab is offered on every project, the same as Schedule (spec
  // 407, REQ-1, REQ-4): a project other than the board's own says there
  // that Deploy is not offered (`otherProjectDeploy`), rather than the tab
  // bar changing shape from project to project.
  // The page opens on Deploy; `?edit=` names a settings table's own edit
  // state, so it always opens on Config, where that table is.
  const tab: ProjectTab = pickTab(PROJECT_TABS, opts.tab, opts.editingGroup ? "config" : "deploy");
  const base = projectPagePath(p.name);
  const panel =
    tab === "deploy" ? deploySection(p.name, opts, now) + testServerSection(p.name, opts)
    : tab === "schedule" ? scheduleSection(p.name, opts.schedule ?? [], opts)
    : configSection(settings, p.name, readiness, opts);

  // "Whether this checkout is behind origin has not been checked yet" is
  // true when it is drawn and false a second or two later, and nothing
  // re-renders this page — so it sat there until the reader changed tab.
  // Ask for the page again, once the answer has had time to arrive, and
  // only on the tab whose sentence goes stale: Config and Schedule carry
  // forms a reload would clear from under someone mid-edit.
  const awaitingDrift = tab === "deploy" && opts.drift?.checkedAt === null;

  const body =
    (awaitingDrift ? reloadMarker(AWAITING_DRIFT_REFRESH_SECONDS) : "") +
    tabbedBody(projectDescription(p), tabBar(PROJECT_TABS, base, tab, {}), panel, opts.backHref ?? PROJECTS_ROUTE, p.name);
  return pageShell(p.name, nav, base, body, generatedAt, {
    script: opts.script, hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
