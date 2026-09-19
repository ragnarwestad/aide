// The served project page (spec 185): drift/deploy, run readiness, and
// the schedule section.

import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import type { ProjectReadiness } from "../../../project/project-admin";
import { FIELD_OWNED_CHECKS, type ProjectSettingsView } from "../../../project/project-settings.ts";
import { SETTING_LABELS } from "../../../project/setting-labels.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { btn, messageSlot, rowMessage } from "../../ui/components";
import { esc, relTimeLabel } from "../../ui/html.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { t } from "../../../i18n";
import { pickTab, tabBar, tabbedBody } from "../job-page";
import { renderScheduleForm } from "../schedule-page/form.ts";
import { schedulePagePath } from "../schedule-page";
import { PROJECTS_ROUTE, projectPagePath } from "./routes.ts";
import { unifiedSettingsTable } from "./settings-table.ts";
import type { ProjectPageOptions, ProjectView } from "./types.ts";

/** The drift sentence's own ending (spec 258), naming the Deploy button
 *  this file draws right beside it — the only ending this wording has,
 *  now that the Projects-list row shows no drift line of its own. */
/** How long a Deploy tab that has no origin answer yet waits before
 *  asking for itself again. The answer is taken by a background poll,
 *  not by this render, so the only page that can be wrong is one drawn
 *  in the seconds before the first poll returns — a restart's own first
 *  page load, every time. Long enough for a `git fetch` to finish,
 *  short enough that nobody reads the stale sentence twice. */
const AWAITING_DRIFT_REFRESH_SECONDS = 5;

/** Shared by `deploySection` and `testServerSection`: the Deploy tab's own
 *  panel wrapper, empty content drawing nothing at all. */
const panel = (inner: string): string => (inner ? `<div class="deploypanel">${inner}</div>` : "");

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
  if (!drift) {
    return heading + panel(
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
  const notYetChecked = drift.checkedAt === null;
  const behind = drift.behind;
  // Only "asked, unanswerable" still bails out with no claim and no
  // button (REQ-5) — "never asked" now falls into the shared chain
  // below (spec 392, REQ-1, REQ-3).
  if (!notYetChecked && behind === null) return heading + panel(errorLine + servingLine); // asked, unanswerable — no claim, never a guess

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

  const sentence = notYetChecked
    ? (() => {
        const phrase = serving && servedCommitPhrase(serving);
        return phrase
          ? `Whether this checkout is behind origin has not been checked yet; ${phrase}.`
          : "Whether this checkout is behind origin has not been checked yet.";
      })()
    : behind! > 0
      ? `${driftPrefix(behind!, drift.checkedAt!, now)} — Deploy pulls ${behind === 1 ? "it" : "them"}, installs` +
        (serving ? ", and restarts the service." : ".")
      : stale
        ? opts.restartWaiting?.length
          ? t(opts.lang ?? "en", "project.deployRestartWaiting", {
              sha: serving!.sha.slice(0, 7),
              jobs: opts.restartWaiting.join(", "),
            })
          : `This checkout matches origin, but the service is still running commit ${serving!.sha.slice(0, 7)}; ` +
            `Deploy restarts it on commit ${serving!.checkoutHead.slice(0, 7)}.`
        : serving
          ? `This checkout matches origin, and the service is running commit ${serving.sha.slice(0, 7)}.`
          : "This checkout matches origin.";

  const title = notYetChecked
    ? "Origin has not been checked yet."
    : disabled
      ? "This checkout matches origin."
      // REQ-9 (spec 392): the button stays live (a press still retries
      // the install), but hovering it says a press will not restart the
      // service sooner.
      : stale && opts.restartWaiting?.length
        ? "Pressing again only repeats the pull and install — it does not restart the service sooner."
        : undefined;

  const button =
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/deploy" class="deployform" ` +
      `data-overlay="${t(opts.lang ?? "en", "shell.overlayDeploying")}">` +
    btn({
      label: "Deploy",
      variant: "primary",
      pending: "deploying…",
      // The title stays the short, common half of the sentence even
      // when the up-to-date-with-serving-current case says more — a
      // hover hint names WHY the button is off, not the whole state.
      ...(disabled ? { disabled: true } : {}),
      ...(title ? { title } : {}),
    }) +
    messageSlot("refused") +
    `</form>`;
  return heading + panel(errorLine + rowMessage(notYetChecked || behind! > 0 || stale ? "waiting" : "info", sentence) + button);
}

/** AC-3/AC-4/AC-8: the section beside Deploy for prod — a button that
 *  starts (or, per AC-6, restarts) a test server from the latest main,
 *  seeded with the round's own test specs. `!opts.testServerAvailable`
 *  mirrors `deploySection()`'s own established pattern: the heading stays,
 *  and a sentence says why there is nothing to act on, rather than the
 *  section disappearing. */
function testServerSection(name: string, opts: ProjectPageOptions): string {
  const lang = opts.lang ?? "en";
  const heading = `<h3>${esc(t(lang, "project.testServerHeading"))}</h3>`;
  if (!opts.testServerAvailable) {
    return heading + panel(rowMessage("info", t(lang, "project.testServerUnavailable")));
  }
  // Deliberately NOT class="deployform"/"actionform"/"rowrun" — any of
  // those three classes gets its native submit replaced by an XHR
  // (`specs-client/forms.ts`/`press.ts`), which silently defeats
  // `target="_blank"` and breaks AC-5. `.deploypanel`'s own flex `gap`
  // spaces this form's children with no CSS of its own needed.
  const button =
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/test-server" ` +
    `target="_blank" class="testserverform">` +
    btn({ label: t(lang, "project.testServerButton"), variant: "primary" }) +
    `</form>`;
  return heading + panel(rowMessage("info", t(lang, "project.testServerNote")) + button);
}

/** The Schedule section (spec 259, extended spec 468): each entry's
 *  name (linking to its own detail page), cron expression, prompt path
 *  and next fire time, and — since spec 468 moved the New-job form here
 *  from the aggregate `/schedule` page — the form to create one for
 *  THIS project. The tab itself is always present (spec 378, REQ-6) —
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
  const table =
    entries.length === 0
      ? `<p class="muted">${t(lang, "schedule.nothingScheduled")}</p>`
      : `<div class="tablewrap"><table class="list"><thead><tr><th>${t(lang, "schedule.colName")}</th>` +
        `<th>${t(lang, "schedule.colCron")}</th><th>${t(lang, "schedule.colPrompt")}</th>` +
        `<th>${t(lang, "schedule.colNextRun")}</th></tr></thead><tbody>` +
        entries
          .map((e) => {
            const next = nextFireTime(e.cron, now);
            return (
              `<tr><td><a href="${esc(schedulePagePath(project, e.name))}">${esc(e.name)}</a></td>` +
              `<td><code>${esc(e.cron)}</code></td><td>${esc(e.prompt)}</td>` +
              `<td>${next ? esc(next.toISOString()) : `<span class="muted">–</span>`}</td></tr>`
            );
          })
          .join("") +
        `</tbody></table></div>`;
  return (
    table +
    `<h3>${t(lang, "schedule.newJob")}</h3>` +
    renderScheduleForm(
      {
        action: "/api/queue/schedule",
        fixedProject: project,
        error: opts.error,
        modelChoices: opts.modelChoices,
        defaultModels: opts.defaultModels,
      },
      lang,
    )
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
  return noFile + summary + checkout + unifiedSettingsTable(settings, name, opts.editing, opts);
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

  // Deploy is offered on every project, the same as Schedule (spec 407,
  // REQ-1, REQ-4): a project with nothing to deploy from here says so on
  // its own tab (`deploySection`'s ungated branch), rather than the tab
  // bar changing shape from project to project.
  const tab: ProjectTab = pickTab(PROJECT_TABS, opts.tab, "config");
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

  const body = tabbedBody("", tabBar(PROJECT_TABS, base, tab, {}), panel, PROJECTS_ROUTE, p.name);
  return pageShell(p.name, nav, base, body, generatedAt, awaitingDrift ? AWAITING_DRIFT_REFRESH_SECONDS : undefined, {
    script: opts.script, hideHeading: true, hideTabBar: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
