// The project page's unified settings table: view mode and edit mode
// in one `<table>`.

import { DERIVABLE, type ProjectSettingsView, type SettingRow } from "../../../project/project-settings.ts";
import { SETTING_LABELS } from "../../../project/setting-labels.ts";
import { btn, messageSlot, rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { projectPagePath } from "./routes.ts";
import type { ProjectPageOptions } from "./types.ts";

/** Which of the two files a `"configured"` row's value came from, in
 *  the words this page uses. Only the Worktree links row ever carries a
 *  `source` on a `"configured"` origin (spec 255) — every other
 *  configured row has exactly one file it could have come from, so
 *  naming it would say nothing a reader does not already know. */
const CONFIGURED_SOURCE_LABEL: Record<string, string> = {
  "project.yaml": ".aide/project.yaml",
  ".aide/config": ".aide/config",
};

/** Where a setting's value came from, in the words the page uses (spec
 *  185). The derived case carries a hedge on purpose: the table in
 *  `core/skills/tools-and-scripts/SKILL.md` calls its commands "the
 *  usual defaults, not a promise" — a project whose `package.json`
 *  names its scripts differently would be shown a command that does not
 *  work, and a reader has to be able to see that it was worked out
 *  rather than checked. Nothing on this page is ever executed. */
function originText(r: SettingRow, home?: ProjectPageOptions["settingsHome"]): string {
  if (r.origin === "configured") {
    // The manifest a run reads is a copy of the dashboard's own file
    // when the project tracks none, and the page names the file a
    // person would change.
    if (r.source === "project.yaml" && home === "dashboard") return "configured, from the dashboard's settings.yaml";
    return r.source ? `configured, from ${esc(CONFIGURED_SOURCE_LABEL[r.source] ?? r.source)}` : "configured";
  }
  if (r.origin === "unset") return "not set";
  return `worked out from ${esc(r.source ?? "")} — the usual ${esc(r.toolchain ?? "")} default, not a verified command`;
}

/** The test command's Comment when nothing is configured. A run and a
 *  landing test with a configured command ONLY (`aide-resolve-test-cmd`),
 *  so a worked-out one runs nothing: the row says so, and names the
 *  worked-out command as the suggestion Edit offers in the field. */
function unsetTestComment(r: SettingRow): string {
  const none = "not set — no tests run when a spec lands";
  if (r.origin !== "derived" || r.value === null) return none;
  return (
    `${none}. Suggested from ${esc(r.source ?? "")}, the usual ${esc(r.toolchain ?? "")} default: ` +
    `<code>${esc(r.value)}</code> — Edit to set it`
  );
}

/** The two values Code landing can take, and the words the page uses
 *  for each — shared between the row's read-only text and its `<select>`
 *  (spec 255; unchanged from the choices `runConfigurationBlock`'s old
 *  editor offered). */
/** `defaultBranch` is the project's OWN branch name, off `origin/HEAD`
 *  — "the default branch" is GitHub's term for it, not a name anybody
 *  reading this row is looking at. `null` where there is no name to
 *  give: the checkout could not be asked, or — the Add form — the
 *  project is not on this machine yet.
 *
 *  "Create", not "leave it for": a `pr` landing runs `gh pr create`
 *  (`aide-run-spec`), so the pull request is made for you. The old
 *  wording read as though nothing would happen. */
export const codeLandingChoices = (defaultBranch: string | null): { value: "merge" | "pr"; label: string }[] => [
  { value: "merge", label: `Merge into ${defaultBranch ?? "the project's main branch"}` },
  { value: "pr", label: "Create a pull request" },
];

/** Which `SETTING_KEYS` entry posts under which form field name, in
 *  edit mode. Lint and build are absent on purpose — nothing a run does
 *  reads them, so they never become an `<input>`. The test command is
 *  here: it is what a run and a landing test with, saved to the
 *  manifest's `testCmd`. */
const EDITABLE_FIELD: Record<string, string> = {
  AIDE_SPECS_PATH: "specsPath",
  AIDE_WORKTREE_LINKS: "worktreeLinks",
  AIDE_INSTALL_CMD: "installCmd",
  AIDE_PREVIEW_CMD: "previewCmd",
  AIDE_TEST_CMD: "testCmd",
};

/** A row's Value cell: plain text in view mode and for lint and build
 *  always (gated on KEY membership, never on the row's current
 *  `origin`); a text `<input>`, pre-filled from the row's own current
 *  value, otherwise. */
function settingValueCell(r: SettingRow, editing: boolean, opts: ProjectPageOptions): string {
  if (!editing || (r.key in DERIVABLE && !(r.key in EDITABLE_FIELD))) {
    return r.value === null ? `<span class="muted">–</span>` : esc(r.value);
  }
  // The test command: only a CONFIGURED value fills the field. A
  // worked-out one is the placeholder, so a save that never touched the
  // row does not quietly configure it.
  if (r.key === "AIDE_TEST_CMD" && r.origin !== "configured") {
    const hint = r.origin === "derived" && r.value ? ` placeholder="${esc(r.value)}"` : "";
    return `<input type="text" name="testCmd" maxlength="300" value=""${hint}>`;
  }
  const field = EDITABLE_FIELD[r.key]!;
  const value = esc(r.value ?? "");
  if (r.key === "AIDE_WORKTREE_LINKS") {
    return (
      `<input type="text" name="${field}" maxlength="300" value="${value}" ` +
      (opts.worktreeLinkCandidates.length ? `list="wtlinks" ` : "") +
      `placeholder="gitignored paths a run must link in: node_modules .venv">` +
      (opts.worktreeLinkCandidates.length
        ? `<datalist id="wtlinks">${opts.worktreeLinkCandidates.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>`
        : "")
    );
  }
  const placeholder = r.key === "AIDE_SPECS_PATH" ? ` placeholder="its own specs/ when empty"` : "";
  return `<input type="text" name="${field}" maxlength="300" value="${value}"${placeholder}>`;
}

/** The Code-landing row (spec 255). Not a `SettingRow` — it has no
 *  `key`/`purpose`/`origin` of its own, only what `resolveCodeLanding()`
 *  answers — so it is built from its own small literal here rather than
 *  coerced into the shape the seven `SETTING_KEYS` rows share. */
function codeLandingRow(codeLanding: "merge" | "pr", editing: boolean, defaultBranch: string | null): string {
  const choices = codeLandingChoices(defaultBranch);
  const value = editing
    ? `<select name="codeLanding">${choices.map(
        (o) => `<option value="${o.value}"${codeLanding === o.value ? " selected" : ""}>${esc(o.label)}</option>`,
      ).join("")}</select>`
    : esc(choices.find((o) => o.value === codeLanding)!.label);
  return `<tr><td>Code landing</td><td>${value}</td><td>What happens to code when a spec is archived</td></tr>`;
}

/** Where the settings are kept, in one sentence above the table (spec
 *  512). Empty when the page was built with no answer. */
function settingsHomeSentence(home: ProjectPageOptions["settingsHome"]): string {
  const say = (text: string) => `<p class="muted" data-settings-home="${home}">${text}</p>`;
  if (home === "dashboard") {
    return say(
      "These settings are kept in the dashboard, in <code>settings.yaml</code> beside its checkouts — " +
        "nothing of them is in the project's repository.",
    );
  }
  if (home === "project") return say("These settings are kept in the project's own <code>.aide/project.yaml</code>.");
  if (home === "shadowed") {
    return say(
      "These settings are kept in the project's own <code>.aide/project.yaml</code>. " +
        "The dashboard's copy, <code>settings.yaml</code>, is not used.",
    );
  }
  if (home === "none") return say("No settings are stored yet.");
  return "";
}

/** The one settings table (spec 255, replacing `settingsTable()` plus
 *  the separate plain-text summary and `<details>` editor it used to sit
 *  beside): Name/Value/Comment columns, the seven `SETTING_KEYS` rows
 *  plus Code landing, and — in edit mode — the whole table wrapped in
 *  one `<form>` so Save posts every changed field together.
 *
 *  `editing` is server-rendered from the request's own `?edit=1`, never
 *  stored: Edit is a link to it, Cancel and a successful Save's redirect
 *  both go to the plain path. Exactly one `<table>` element exists in
 *  the response either way. */
export function unifiedSettingsTable(
  settings: ProjectSettingsView,
  name: string,
  editing: boolean,
  opts: ProjectPageOptions,
): string {
  const path = projectPagePath(name);
  const codeLanding = opts.codeLanding ?? "merge";
  const rows =
    settings.rows
      .map((r) => {
        // A value that does not resolve is marked where it is shown, in
        // readiness's own sentence — never a second wording of the same
        // fact (`project-settings.ts` reads it verbatim). Blocking-aware
        // (spec 372): the same check's `blocking` flag decides the kind
        // here exactly as it does above the table, so the two never
        // disagree about the same fact's colour.
        const problem = r.problem ? rowMessage(r.problem.blocking ? "failed" : "waiting", r.problem.text) : "";
        const unsetTest = r.key === "AIDE_TEST_CMD" && r.origin !== "configured";
        return (
          `<tr><td>${esc(SETTING_LABELS[r.key] ?? r.key)} <span class="muted">${esc(r.key)}</span></td>` +
          `<td>${unsetTest && !editing ? `<span class="muted">–</span>` : settingValueCell(r, editing, opts)}</td>` +
          `<td>${esc(r.purpose)} — ${unsetTest ? unsetTestComment(r) : originText(r, opts.settingsHome)}${problem}</td></tr>`
        );
      })
      .join("") + codeLandingRow(codeLanding, editing, opts.defaultBranch ?? null);
  const table =
    settingsHomeSentence(opts.settingsHome) +
    `<div class="tablewrap"><table class="list">` +
    `<colgroup><col data-col="setting-name"><col data-col="setting-value"><col data-col="setting-comment"></colgroup>` +
    `<thead><tr><th>Name</th><th>Value</th>` +
    `<th>Comment</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  if (!editing) {
    // Two buttons even while reading (spec 301): Cancel sits here too,
    // visibly disabled, so pressing Edit only swaps the two labels and
    // enables the second button — nothing appears or disappears.
    return (
      `<div class="configactions"><a class="btn primary" href="${esc(path)}?edit=1">Edit</a>` +
      btn({ label: "Cancel", type: "button", disabled: true }) +
      `</div>` +
      table
    );
  }
  return (
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/settings" class="newspecform projectsettingsform">` +
    (opts.error ? rowMessage("failed", opts.error, { hook: "refusal", tag: "p" }) : "") +
    // `.configactions` carries its own `flex-basis: 100%`, so it stacks
    // above the table the same way `.frow` does without needing that
    // wrapper itself (spec 301).
    `<div class="configactions">${btn({ label: "Save", variant: "primary", pending: "saving…" })}` +
    // No `${prefix}-cancel` id like the other Cancel controls on this
    // page's siblings (a plain link, not a submit-form pair) —
    // `data-discard-changes` gives unsaved-changes.ts the same
    // exemption by a different marker (spec 438).
    `<a class="btn" data-discard-changes href="${esc(path)}">Cancel</a></div>` +
    `<span class="frow">${table}</span>` +
    messageSlot("refused") +
    `</form>`
  );
}
