// The project page's settings tables: one per file (spec 549), view mode
// and edit mode in the same markup.

import type { PreviewFrom } from "../../../project/parse-manifest.ts";
import {
  EDIT_GROUP_PARAM,
  EDITABLE_FIELD,
  SETTING_GROUPS,
  type ProjectSettingsView,
  type SettingRow,
  type SettingsGroupFile,
} from "../../../project/project-settings.ts";
import { SETTING_LABELS } from "../../../project/setting-labels.ts";
import { btn, btnLink, messageSlot, rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { projectPagePath } from "./routes.ts";
import type { ProjectPageOptions } from "./types.ts";

/** The test command's Comment when nothing is configured. A run and a
 *  landing test with a configured command ONLY (`aide-resolve-test-cmd`),
 *  so a worked-out one runs nothing: the row says so, and names the
 *  worked-out command as the suggestion Edit offers in the field. */
function unsetTestComment(r: SettingRow): string {
  const none = "No tests run when a spec lands";
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

/** The words for the three ways a branch can be tried, in the order the
 *  parser lists them (`PREVIEW_FROMS`). The values are what the manifest
 *  stores and are not translated along with the labels. */
export const previewFromChoices = (): { value: PreviewFrom; label: string }[] => [
  { value: "none", label: "Not before it is merged" },
  { value: "command", label: "A test server on this machine" },
  { value: "cloudflare-pages", label: "A Cloudflare Pages preview" },
];

/** A row's Value cell: plain text in view mode; a one-line
 *  `<textarea data-oneline>`, pre-filled from the
 *  row's own current value, otherwise. A textarea wraps a long value,
 *  which an `<input>` cannot; `bindOneLineFields` gives back what the
 *  input did (growth, Enter to save, no line break). `isEditingThis` is
 *  whether THIS row's own table is the one being edited (spec 552: each
 *  table now has its own edit state). */
function settingValueCell(r: SettingRow, isEditingThis: boolean, opts: ProjectPageOptions): string {
  if (!isEditingThis) {
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
  if (r.key === "worktreeLinks") {
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
  // The description's limit is Add's own, 500; every other row keeps 300.
  const placeholder =
    r.key === "AIDE_SPECS_PATH"
      ? ` placeholder="its own specs/ when empty"`
      : r.key === "description"
        ? ` placeholder="one line: what the project is"`
        : "";
  const maxlength = r.key === "description" ? 500 : 300;
  return `<textarea name="${field}" data-oneline rows="1" maxlength="${maxlength}"${placeholder}>${value}</textarea>`;
}

/** A row that is a choice of fixed values: a `<select>` in edit mode,
 *  the chosen label in view mode. Not a `SettingRow` — it has no
 *  `key`/`origin` of its own, only what its resolver answers. */
function choiceRow(
  label: string,
  name: string,
  choices: { value: string; label: string }[],
  current: string,
  isEditingThis: boolean,
  purpose: string,
): string {
  const value = isEditingThis
    ? `<select name="${name}">${choices.map(
        (o) => `<option value="${o.value}"${current === o.value ? " selected" : ""}>${esc(o.label)}</option>`,
      ).join("")}</select>`
    : esc(choices.find((o) => o.value === current)!.label);
  return `<tr><td>${esc(label)}</td><td data-col="setting-value">${value}</td><td>${esc(purpose)}</td></tr>`;
}

/** The Code-landing row (spec 255), built from what
 *  `resolveCodeLanding()` answers. Lives in the manifest table (spec
 *  549): it is a manifest-only fact already. */
function codeLandingRow(codeLanding: "merge" | "pr", isEditingThis: boolean, defaultBranch: string | null): string {
  return choiceRow(
    "Code landing", "codeLanding", codeLandingChoices(defaultBranch), codeLanding, isEditingThis,
    "What happens to code when a spec is archived",
  );
}

/** The Try a branch row, built from what `resolvePreviewFrom()` answers:
 *  how a spec's branch can be tried before it is merged. Sits in the
 *  manifest table beside Code landing. */
function previewFromRow(previewFrom: PreviewFrom, isEditingThis: boolean): string {
  return choiceRow(
    "Try a branch", "previewFrom", previewFromChoices(), previewFrom, isEditingThis,
    "How a spec's branch can be tried before it is merged",
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

/** One table's own Edit, or its Save/Cancel, on the same line as its
 *  heading (AC-1, AC-2): Save/Cancel while THIS table is being edited,
 *  Edit — enabled — while nothing is, Edit — disabled — while the OTHER
 *  table is (AC-4: present in the markup, not removed). */
function settingsTableActions(file: SettingsGroupFile, editingGroup: SettingsGroupFile | null, path: string): string {
  if (editingGroup === file) {
    return (
      `<span class="factions">${btn({ label: "Save", variant: "primary", pending: "saving…" })}` +
      // No `${prefix}-cancel` id like the other Cancel controls on this
      // page's siblings (a plain link, not a submit-form pair) —
      // `data-discard-changes` gives unsaved-changes.ts the same
      // exemption by a different marker (spec 438).
      `${btnLink({ href: `${path}?tab=config`, label: "Cancel", data: { "discard-changes": "" } })}</span>`
    );
  }
  const disabled = editingGroup !== null;
  return `<span class="factions">${
    disabled
      ? btn({ label: "Edit", type: "button", disabled: true })
      : btnLink({ href: `${path}?edit=${EDIT_GROUP_PARAM[file]}`, label: "Edit", variant: "primary" })
  }</span>`;
}

/** One heading-and-table block, wrapped for horizontal scroll like every
 *  other list on this page — heading, its own Edit/Save/Cancel and the
 *  table together in one element, so the block is a single unit
 *  wherever it is placed (a `.frow`'s own children lay out side by
 *  side, and the heading is not a second column beside its table). */
function settingsTableFor(heading: string, rows: string, actions: string): string {
  return (
    `<div><div class="panelhead"><h3>${esc(heading)}</h3>${actions}</div>` +
    `<div class="tablewrap"><table class="list">` +
    `<colgroup><col data-col="setting-name"><col data-col="setting-value"><col data-col="setting-comment"></colgroup>` +
    `<thead><tr><th>Name</th><th>Value</th>` +
    `<th>Comment</th></tr></thead><tbody>${rows}</tbody></table></div></div>`
  );
}

/** One setting's `<tr>` — no Comment cell ever names a file (AC-2): which
 *  file a row belongs to is said once, in its table's own heading. */
function settingRowHtml(r: SettingRow, isEditingThis: boolean, opts: ProjectPageOptions): string {
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
    `${unsetTest && !isEditingThis ? `<span class="muted">–</span>` : settingValueCell(r, isEditingThis, opts)}</td>` +
    `<td>${[esc(r.purpose), unsetTest ? unsetTestComment(r) : ""].filter(Boolean).join(" — ")}${problem}</td></tr>`
  );
}

/** The Config tab's two settings tables (spec 549: one per file; spec
 *  552: each with its own Edit/Save/Cancel, in place of the single
 *  button row that used to sit above both) — at most one open for
 *  editing at a time, and both wrapped in one `<form>` while one is, so
 *  Save posts only that table's own fields.
 *
 *  `editingGroup` is server-rendered from the request's own `?edit=`,
 *  never stored: each table's own Edit is a link to it, Cancel and a
 *  successful Save's redirect both go to the Config tab without it.
 *  Exactly two `<table>` elements exist in the response either way. */
export function unifiedSettingsTable(
  settings: ProjectSettingsView,
  name: string,
  editingGroup: SettingsGroupFile | null,
  opts: ProjectPageOptions,
): string {
  const path = projectPagePath(name);
  const codeLanding = opts.codeLanding ?? "merge";
  const previewFrom = opts.previewFrom ?? "none";
  const rowFor = (key: string): SettingRow | undefined => settings.rows.find((r) => r.key === key);
  const tables = SETTING_GROUPS.map((group) => {
    const isEditingThis = editingGroup === group.file;
    const rows = group.keys
      .map((key) => rowFor(key))
      .filter((r): r is SettingRow => r !== undefined)
      .map((r) => settingRowHtml(r, isEditingThis, opts))
      .join("");
    const heading = group.file === ".aide/config" ? ".aide/config" : manifestFileHeading(opts.settingsHome);
    const withChoices =
      group.file === "manifest"
        ? rows + codeLandingRow(codeLanding, isEditingThis, opts.defaultBranch ?? null) + previewFromRow(previewFrom, isEditingThis)
        : rows;
    return settingsTableFor(heading, withChoices, settingsTableActions(group.file, editingGroup, path));
  });
  if (editingGroup === null) return `<div class="configtables">${tables.join("")}</div>`;
  return (
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/settings" class="pageform projectsettingsform">` +
    // One `.frow` per table (spec 531's reasoning extends to two): each
    // is its own full-width line in `.pageform`'s flex-wrap layout, so
    // the two tables stack rather than squeeze onto one row beside it.
    tables.map((t) => `<span class="frow">${t}</span>`).join("") +
    messageSlot("refused") +
    `</form>`
  );
}
