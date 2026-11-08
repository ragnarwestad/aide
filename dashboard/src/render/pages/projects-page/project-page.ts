// The served project page: drift/deploy, run readiness, and
// the schedule section.

import type { ScheduleEntry } from "../../../queue/schedule.ts";
import type { ProjectReadiness, ReadinessCheck } from "../../../project/project-admin";
import { FIELD_OWNED_CHECKS, type ProjectSettingsView } from "../../../project/project-settings.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { askButton, btnLink, buttonForm, helpPopover, messageSlot, rowMessage } from "../../ui/components";
import { jobsSentence } from "../../ui/components/spec-name.ts";
import { esc, relTimeLabel } from "../../ui/html.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { renderMessage, renderSentence } from "../../../i18n/message.ts";
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
export const NO_DEPLOY_SENTENCE = t("en", "project.noDeploy");

/** Shared by `deploySection` and `testServerSection`: the Deploy tab's own
 *  panel wrapper, empty content drawing nothing at all. */
const panel = (inner: string): string => (inner ? `<div class="deploypanel">${inner}</div>` : "");

/** The Deploy section, with the address the page script asks origin
 *  through when the tab is open (`specs-client/deploy/origin-check.ts`). */
const checked = (name: string, inner: string): string =>
  `<div data-origin-check="${esc(`/api/queue/projects/${encodeURIComponent(name)}/drift`)}">${inner}</div>`;

export const driftPrefix = (behind: number, checkedAt: number, now: number, lang: Language = "en"): string =>
  t(lang, behind === 1 ? "project.driftOne" : "project.driftMany", {
    n: behind, when: relTimeLabel(new Date(checkedAt).toISOString(), now, lang),
  });

/** Every project but the board's own: how far its checkout is behind
 *  origin, and one sentence saying Deploy is not offered. No button, and
 *  no claim when origin was asked and could not answer. */
function otherProjectDeploy(
  name: string,
  drift: ProjectDrift | undefined,
  now: number,
  heading: string,
  servingLine: string,
  lang: Language,
): string {
  const line = !drift
    ? ""
    : drift.checkedAt === null
      ? rowMessage("waiting", t(lang, "project.notChecked"))
      : drift.behind === null
        ? "" // asked, unanswerable: no claim
        : drift.behind > 0
          ? rowMessage("waiting", `${driftPrefix(drift.behind, drift.checkedAt, now, lang)}.`)
          : rowMessage("info", t(lang, "project.matchesOrigin"));
  const inner = heading + panel(line + servingLine + rowMessage("info", t(lang, "project.noDeploy")));
  return drift ? checked(name, inner) : inner;
}

/** The board's own Deploy: plainly whether this checkout is behind
 *  origin, and — only when it is, and only when a deploy step is
 *  configured — a button that asks, and queues the deploy job.
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
 *  disk-vs-origin (`drift`) and process-vs-disk (`serving`)
 *  fold into the ONE sentence the reader needs, in whichever of the
 *  three shapes applies — up to date, behind, or installed but not
 *  restarted. `serving` is undefined for every project except the one
 *  this server itself runs from (`ProjectPageOptions.serving`). */
function deploySection(name: string, opts: ProjectPageOptions, now: number): string {
  // This section's own heading, so it reads apart from the
  // new "Testserver med testspecene" section beside it.
  const lang = opts.lang ?? "en";
  const heading = `<h3>${esc(t(lang, "project.deployHeading"))}</h3>`;
  const serving = opts.serving;
  const servingLine = serving
    ? rowMessage(
        serving.current ? "info" : "waiting",
        serving.current
          ? t(lang, "project.servingCurrent", { sha: serving.sha.slice(0, 7) })
          : t(lang, "project.servingStale", { sha: serving.sha.slice(0, 7), head: serving.checkoutHead.slice(0, 7) }),
      )
    : "";
  const drift = opts.drift;
  if (!opts.boardItself) return otherProjectDeploy(name, drift, now, heading, servingLine, lang);
  if (!drift) {
    return heading + panel(
      rowMessage("info", t(lang, "project.noInstallCmd")) + servingLine,
    );
  }
  // Shown wherever `drift` is defined, never in the ungated branch above.
  // The kept failure names its step, and carries `deploy-error`.
  const failure = opts.deployFailure;
  const errorLine = failure
    ? rowMessage(
        "failed",
        renderMessage(lang, { key: "deploy.stepFailed", values: { step: t(lang, STEP_LABEL[failure.step]!) }, inner: failure.sentence }),
        {
          hook: "refusal deploy-error",
          tag: "p",
          ...(failure.detail ? { actions: helpPopover("what it printed", esc(failure.detail)) } : {}),
        },
      )
    : "";
  const notYetChecked = drift.checkedAt === null;
  const behind = drift.behind;
  // Only "asked, unanswerable" still bails out with no claim and no
  // button — "never asked" now falls into the shared chain
  // below.
  if (!notYetChecked && behind === null) return checked(name, heading + panel(errorLine + servingLine)); // asked, unanswerable — no claim, never a guess

  // From here the checkout's own drift is either known, or not yet
  // asked at all, so its answer and the Serving line's answer (when
  // there is one) fold into one sentence instead of stacking as two
  const stale = !!serving && !serving.current;
  const disabled = notYetChecked || (behind === 0 && !stale);

  // What to say about the served commit
  // when origin itself is still unknown — never a bare hash, and never
  // phrased twice (the `stale` sentence below keeps its own bare-hash
  // wording exactly as it is).
  const servedCommitPhrase = (s: NonNullable<typeof serving>): string | undefined =>
    s.newestSubject === undefined
      ? undefined // git could not answer — fail open, no invented claim
      : s.current
        ? t(lang, "project.servedNewest", { subject: s.newestSubject })
        : t(lang, s.behindCount === 1 ? "project.servedBehindOne" : "project.servedBehindMany", {
            n: s.behindCount ?? "some", subject: s.newestSubject,
          });

  let sentenceHtml: string | undefined;
  const sentence = notYetChecked
    ? (() => {
        const phrase = serving && servedCommitPhrase(serving);
        return phrase
          ? t(lang, "project.notCheckedWith", { phrase })
          : t(lang, "project.notChecked");
      })()
    : behind! > 0
      ? t(lang, `project.behind${behind === 1 ? "One" : "Many"}${serving ? "Restart" : ""}` as TranslationKey, {
          prefix: driftPrefix(behind!, drift.checkedAt!, now, lang),
        })
      : stale
        ? opts.restartWaiting?.length
          ? (() => {
              const s = jobsSentence(
                lang, "project.deployRestartWaiting",
                { sha: serving!.sha.slice(0, 7) }, opts.restartWaiting!,
              );
              sentenceHtml = s.html;
              return s.text;
            })()
          : t(lang, "project.stale", { sha: serving!.sha.slice(0, 7), head: serving!.checkoutHead.slice(0, 7) })
        : serving
          ? t(lang, "project.servingMatches", { sha: serving.sha.slice(0, 7) })
          : t(lang, "project.matchesOrigin");

  const title = notYetChecked
    ? t(lang, "project.originUnchecked")
    : disabled
      ? t(lang, "project.matchesOrigin")
      // The button stays live (a press still retries
      // the install), but hovering it says a press will not restart the
      // service sooner.
      : stale && opts.restartWaiting?.length
        ? t(lang, "project.pressAgain")
        : undefined;

  // The board's own Deploy asks first, and OK queues the job. A second press
  // is refused while one is under way, and the hover line says so.
  const dialogId = "deployask";
  const underWay = opts.deployUnderWay
    ? t(lang, "project.deployUnderWay", { state: t(lang, `state.${opts.deployUnderWay}`) })
    : undefined;
  const ask =
    askButton({ label: t(lang, "project.deployButton"), dialogId, variant: "primary", disabled, title: underWay ?? title }) +
    deployAskDialog(lang, name, dialogId);
  return checked(
    name,
    heading + panel(errorLine + rowMessage(notYetChecked || behind! > 0 || stale ? "waiting" : "info", sentence, { html: sentenceHtml }) + ask),
  );
}

/** The section beside Deploy for prod — a button that
 *  starts (or restarts) a test server from the latest main,
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
  // `target="_blank"` and so the new-tab open. `.deploypanel`'s own flex `gap`
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

/** The Schedule section: each entry's
 *  name (linking to its own detail page), next fire time, its Enabled
 *  switch, Run now and Delete — what fits on one line; the rest of what
 *  an entry is set to is on its own Settings tab — and New, which makes
 *  one for THIS project. The tab itself is always present —
 *  a project with nothing scheduled says so in a sentence, rather than
 *  the tab bar changing shape from project to project.
 *
 *  The form is drawn unconditionally — `1-description.md`'s own
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
              scheduleControlCells(project, e, lang) +
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

/** A check's answer in the reader's language: its message, or its English
 *  text for an answer that carries none. */
const checkSentence = (c: ReadinessCheck, lang: Language): string => renderSentence(lang, c.message ?? c.detail) ?? c.detail;

/** The checks no settings row owns that did NOT pass
 *  — a check that passed says nothing here; the summary line above
 *  has already said as much. `FIELD_OWNED_CHECKS` keeps this the one
 *  place a fact this page draws twice cannot disagree with itself. */
function checkoutChecks(readiness: ProjectReadiness, lang: Language): string {
  const checks = readiness.checks.filter((c) => !FIELD_OWNED_CHECKS.has(c.check) && !c.ok);
  return checks.map((c) => rowMessage(c.blocking ? "failed" : "waiting", checkSentence(c, lang))).join("");
}

/** The one line at the top of Config saying whether a run can start
 *  the information card while nothing blocks it, and the
 *  board's own error card, naming every blocking reason in the same
 *  words its own check already carries, when something does.
 *  `readiness.canRun` guarantees at least one blocking check exists in
 *  the false branch (`readiness.ts`: `canRun = checks.every(c =>
 *  !c.blocking)`). Non-blocking-but-failing checks are named in their
 *  own amber card below (`checkoutChecks`), not repeated here. */
function readinessSummary(readiness: ProjectReadiness, lang: Language): string {
  if (readiness.canRun) {
    return rowMessage("info", t(lang, "project.readinessOk"));
  }
  const reasons = readiness.checks.filter((c) => c.blocking).map((c) => checkSentence(c, lang));
  return rowMessage("failed", t(lang, "project.cannotStart", { reasons: reasons.join("; ") }));
}

/** The Config tab: the settings table, plus — since the Health tab went
 *  away — whether a run can start at all, and the checks no
 *  settings row owns. `readiness` is `null` where git could not be
 *  asked, which is also why both new pieces are absent then: a page
 *  cannot claim a run can or cannot start on no evidence. */
function configSection(
  settings: ProjectSettingsView,
  name: string,
  readiness: ProjectReadiness | null,
  opts: ProjectPageOptions,
): string {
  const lang = opts.lang ?? "en";
  // "No file" and "a file that sets nothing" are different states, and
  // the first is the ordinary one for a project cloned onto a second
  // machine — said plainly, above the rows, so seven "not set" lines
  // have an explanation rather than reading as seven separate
  // omissions.
  const noFile = settings.hasConfigFile
    ? ""
    : rowMessage("info", t(lang, "project.noConfigFile"));
  const summary = readiness ? readinessSummary(readiness, lang) : "";
  const checkout = readiness ? checkoutChecks(readiness, lang) : "";
  return noFile + summary + checkout + unifiedSettingsTable(settings, name, opts.editingGroup, opts);
}

/** The page's tabs, in the order they are drawn: Deploy first. Default
 *  capitalization (`tabBar`'s own `t[0].toUpperCase() + t.slice(1)`)
 *  already produces the exact words wanted, so — unlike `JOB_TABS`'s
 *  `steps` → "Logs" — no label override map is needed.
 *  Health is gone: every check it drew now reads on Config,
 *  either on its own settings row or in the checkout-level section. */
const PROJECT_TABS = ["deploy", "config", "schedule"] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

/** The served project page: the settings, the readiness answer, the
 *  deploy state and the schedule, one tab at a time rather than one
 *  long scroll. */
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

  // The Deploy tab is offered on every project, the same as Schedule:
  // a project other than the board's own says there
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
    tabbedBody(
      projectDescription(p), tabBar(PROJECT_TABS, base, tab, {}, "", { lang: opts.lang }), panel,
      opts.backHref ?? PROJECTS_ROUTE, p.name, false, "", opts.lang ?? "en",
    );
  return pageShell(p.name, nav, base, body, generatedAt, {
    script: opts.script, hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
