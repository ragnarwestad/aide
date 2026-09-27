// The project page's settings tables: one per file (spec 549), view mode
// and edit mode in the same markup.

import { SETTING_GROUPS, type ProjectSettingsView, type SettingRow } from "../../../project/project-settings.ts";
import { SETTING_LABELS } from "../../../project/setting-labels.ts";
import { btn, messageSlot, rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { projectPagePath } from "./routes.ts";
import type { ProjectPageOptions } from "./types.ts";

/** The test command's Comment when nothing is configured. A run and a
 *  landing test with a configured command ONLY (`aide-resolve-test-cmd`),
 *  so a worked-out one runs nothing: the row says so, and names the
 *  worked-out command as the suggestion Edit offers in the field. */
function unsetTestComment(r: SettingRow): string {
  const none = "no tests run when a spec lands";
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
 *  edit mode. The test command is what a run and a landing test with,
 *  saved to the manifest's `AIDE_TEST_CMD`. */
const EDITABLE_FIELD: Record<string, string> = {
  AIDE_SPECS_PATH: "specsPath",
  AIDE_WORKTREE_LINKS: "worktreeLinks",
  AIDE_INSTALL_CMD: "installCmd",
  AIDE_PREVIEW_CMD: "previewCmd",
  AIDE_TEST_CMD: "testCmd",
};

/** A row's Value cell: plain text in view mode; a one-line
 *  `<textarea data-oneline>`, pre-filled from the
 *  row's own current value, otherwise. A textarea wraps a long value,
 *  which an `<input>` cannot; `bindOneLineFields` gives back what the
 *  input did (growth, Enter to save, no line break). */
function settingValueCell(r: SettingRow, editing: boolean, opts: ProjectPageOptions): string {
  if (!editing) {
    return r.value === null ? `<span class="muted">–</span>` : esc(r.value);
  }
  // The test command: only a CONFIGURED value fills the field. A
  // worked-out one is the placeholder, so a save that never touched the
  // row does not quietly configure it.
  if (r.key === "AIDE_TEST_CMD" && r.origin !== "configured") {
    const hint = r.origin === "derived" && r.value ? ` placeholder="${esc(r.value)}"` : "";
    return `<textarea name="testCmd" data-oneline rows="1" maxlength="300"${hint}></textarea>`;
  }
  const field = EDITABLE_FIELD[r.key]!;
  const value = esc(r.value ?? "");
  if (r.key === "AIDE_WORKTREE_LINKS") {
    // A `<datalist>` cannot be attached to a textarea, so the
    // candidates are text under the field, in the order and spacing a
    // value is typed.
    return (
      `<textarea name="${field}" data-oneline rows="1" maxlength="300" ` +
      `placeholder="gitignored paths a run must link in: node_modules .venv">${value}</textarea>` +
      (opts.worktreeLinkCandidates.length
        ? `<span class="muted">Suggested from the checkout's .gitignore: ${opts.worktreeLinkCandidates.map(esc).join(" ")}</span>`
        : "")
    );
  }
  const placeholder = r.key === "AIDE_SPECS_PATH" ? ` placeholder="its own specs/ when empty"` : "";
  return `<textarea name="${field}" data-oneline rows="1" maxlength="300"${placeholder}>${value}</textarea>`;
}

/** The Code-landing row (spec 255). Not a `SettingRow` — it has no
 *  `key`/`purpose`/`origin` of its own, only what `resolveCodeLanding()`
 *  answers — so it is built from its own small literal here rather than
 *  coerced into the shape the five `SETTING_KEYS` rows share. Lives in
 *  the manifest table (spec 549): it is a manifest-only fact already. */
function codeLandingRow(codeLanding: "merge" | "pr", editing: boolean, defaultBranch: string | null): string {
  const choices = codeLandingChoices(defaultBranch);
  const value = editing
    ? `<select name="codeLanding">${choices.map(
        (o) => `<option value="${o.value}"${codeLanding === o.value ? " selected" : ""}>${esc(o.label)}</option>`,
      ).join("")}</select>`
    : esc(choices.find((o) => o.value === codeLanding)!.label);
  return (
    `<tr><td>Code landing</td><td data-col="setting-value">${value}</td>` +
    `<td>What happens to code when a spec is archived</td></tr>`
  );
}

/** The manifest table's own file name (spec 512): the project's tracked
 *  `.aide/project.yaml`, or the dashboard's derived `settings.yaml` when
 *  the project tracks none. This is the one fact the removed
 *  above-the-table sentence stated that still needs saying (AC-1) — said
 *  once, in the table's own heading, instead of in a sentence above it
 *  (AC-2 drops that sentence). */
function manifestFileHeading(home: ProjectPageOptions["settingsHome"]): string {
  return home === "dashboard" ? "the dashboard's settings.yaml" : ".aide/project.yaml";
}

/** One `<h3>`-headed table, wrapped for horizontal scroll like every
 *  other list on this page — heading and table together in one element,
 *  so the pair is a single block wherever it is placed (a `.frow`'s own
 *  children lay out side by side, and the heading is not a second column
 *  beside its table). */
function settingsTableFor(heading: string, rows: string): string {
  return (
    `<div><h3>${esc(heading)}</h3><div class="tablewrap"><table class="list">` +
    `<colgroup><col data-col="setting-name"><col data-col="setting-value"><col data-col="setting-comment"></colgroup>` +
    `<thead><tr><th>Name</th><th>Value</th>` +
    `<th>Comment</th></tr></thead><tbody>${rows}</tbody></table></div></div>`
  );
}

/** One setting's `<tr>` — no Comment cell ever names a file (AC-2): which
 *  file a row belongs to is said once, in its table's own heading. */
function settingRowHtml(r: SettingRow, editing: boolean, opts: ProjectPageOptions): string {
  // A value that does not resolve is marked where it is shown, in
  // readiness's own sentence — never a second wording of the same fact
  // (`project-settings.ts` reads it verbatim). Blocking-aware (spec
  // 372): the same check's `blocking` flag decides the kind here exactly
  // as it does above the table, so the two never disagree about the same
  // fact's colour.
  const problem = r.problem ? rowMessage(r.problem.blocking ? "failed" : "waiting", r.problem.text) : "";
  const unsetTest = r.key === "AIDE_TEST_CMD" && r.origin !== "configured";
  return (
    `<tr><td>${esc(SETTING_LABELS[r.key] ?? r.key)} <span class="muted">${esc(r.key)}</span></td>` +
    `<td data-col="setting-value">` +
    `${unsetTest && !editing ? `<span class="muted">–</span>` : settingValueCell(r, editing, opts)}</td>` +
    `<td>${[esc(r.purpose), unsetTest ? unsetTestComment(r) : ""].filter(Boolean).join(" — ")}${problem}</td></tr>`
  );
}

/** The Config tab's two settings tables (spec 549: one per file, in
 *  place of the single table plus the sentence above it that used to say
 *  which file each row came from), and — in edit mode — both wrapped in
 *  one `<form>` so Save posts every changed field together.
 *
 *  `editing` is server-rendered from the request's own `?edit=1`, never
 *  stored: Edit is a link to it, Cancel and a successful Save's redirect
 *  both go to the Config tab without it. Exactly two `<table>` elements
 *  exist in the response either way. */
export function unifiedSettingsTable(
  settings: ProjectSettingsView,
  name: string,
  editing: boolean,
  opts: ProjectPageOptions,
): string {
  const path = projectPagePath(name);
  const codeLanding = opts.codeLanding ?? "merge";
  const rowFor = (key: string): SettingRow | undefined => settings.rows.find((r) => r.key === key);
  const tables = SETTING_GROUPS.map((group) => {
    const rows = group.keys
      .map((key) => rowFor(key))
      .filter((r): r is SettingRow => r !== undefined)
      .map((r) => settingRowHtml(r, editing, opts))
      .join("");
    const heading = group.file === ".aide/config" ? ".aide/config" : manifestFileHeading(opts.settingsHome);
    const withCodeLanding =
      group.file === "manifest" ? rows + codeLandingRow(codeLanding, editing, opts.defaultBranch ?? null) : rows;
    return settingsTableFor(heading, withCodeLanding);
  });
  if (!editing) {
    // Two buttons even while reading (spec 301): Cancel sits here too,
    // visibly disabled, so pressing Edit only swaps the two labels and
    // enables the second button — nothing appears or disappears.
    return (
      `<div class="configactions"><a class="btn primary" href="${esc(path)}?edit=1">Edit</a>` +
      btn({ label: "Cancel", type: "button", disabled: true }) +
      `</div>` +
      tables.join("")
    );
  }
  return (
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/settings" class="newspecform projectsettingsform">` +
    (opts.error ? rowMessage("failed", opts.error, { hook: "refusal", tag: "p" }) : "") +
    // `.configactions` carries its own `flex-basis: 100%`, so it stacks
    // above the tables the same way `.frow` does without needing that
    // wrapper itself (spec 301).
    `<div class="configactions">${btn({ label: "Save", variant: "primary", pending: "saving…" })}` +
    // No `${prefix}-cancel` id like the other Cancel controls on this
    // page's siblings (a plain link, not a submit-form pair) —
    // `data-discard-changes` gives unsaved-changes.ts the same
    // exemption by a different marker (spec 438).
    `<a class="btn" data-discard-changes href="${esc(path)}?tab=config">Cancel</a></div>` +
    // One `.frow` per table (spec 531's reasoning extends to two): each
    // is its own full-width line in `.newspecform`'s flex-wrap layout, so
    // the two tables stack rather than squeeze onto one row beside it.
    tables.map((t) => `<span class="frow">${t}</span>`).join("") +
    messageSlot("refused") +
    `</form>`
  );
}
