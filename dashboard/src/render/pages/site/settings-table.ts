// The project page's unified settings table: view mode and edit mode
// in one `<table>`.

import { DERIVABLE, type ProjectSettingsView, type SettingRow } from "../../../project/project-settings.ts";
import { SETTING_LABELS } from "../../../project/setting-labels.ts";
import { btn, messageSlot, rowMessage, tokenField } from "../../ui/components.ts";
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
function originText(r: SettingRow): string {
  if (r.origin === "configured") {
    return r.source ? `configured, from ${esc(CONFIGURED_SOURCE_LABEL[r.source] ?? r.source)}` : "configured";
  }
  if (r.origin === "unset") return "not set";
  return `worked out from ${esc(r.source ?? "")} — the usual ${esc(r.toolchain ?? "")} default, not a verified command`;
}

/** The two values Code landing can take, and the words the page uses
 *  for each — shared between the row's read-only text and its `<select>`
 *  (spec 255; unchanged from the choices `runConfigurationBlock`'s old
 *  editor offered). */
const CODE_LANDING_CHOICES: { value: "merge" | "pr"; label: string }[] = [
  { value: "merge", label: "Merge into the default branch" },
  { value: "pr", label: "Leave it for a pull request" },
];

/** Which `SETTING_KEYS` entry posts under which form field name, in
 *  edit mode. The three `DERIVABLE` keys are absent on purpose — they
 *  never become an `<input>`, whatever `editing` says. */
const EDITABLE_FIELD: Record<string, string> = {
  AIDE_SPECS_PATH: "specsPath",
  AIDE_WORKTREE_LINKS: "worktreeLinks",
  AIDE_INSTALL_CMD: "installCmd",
  AIDE_JIRA_BASE_URL: "jiraBaseUrl",
};

/** A row's Value cell: plain text in view mode and for the three
 *  `DERIVABLE` keys always (criterion 3 — gated on KEY membership in
 *  `DERIVABLE`, never on the row's current `origin`, so a derivable key
 *  that happens to be `unset` right now still stays read-only); a text
 *  `<input>`, pre-filled from the row's own current value, otherwise. */
function settingValueCell(r: SettingRow, editing: boolean, opts: ProjectPageOptions): string {
  if (!editing || r.key in DERIVABLE) {
    return r.value === null ? `<span class="muted">–</span>` : esc(r.value);
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
function codeLandingRow(codeLanding: "merge" | "pr", editing: boolean): string {
  const value = editing
    ? `<select name="codeLanding">${CODE_LANDING_CHOICES.map(
        (o) => `<option value="${o.value}"${codeLanding === o.value ? " selected" : ""}>${esc(o.label)}</option>`,
      ).join("")}</select>`
    : esc(CODE_LANDING_CHOICES.find((o) => o.value === codeLanding)!.label);
  return `<tr><td>Code landing</td><td>${value}</td><td>What happens to code when a spec is archived</td></tr>`;
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
        return (
          `<tr><td>${esc(SETTING_LABELS[r.key] ?? r.key)} <span class="muted">${esc(r.key)}</span></td>` +
          `<td>${settingValueCell(r, editing, opts)}</td>` +
          `<td>${esc(r.purpose)} — ${originText(r)}${problem}</td></tr>`
        );
      })
      .join("") + codeLandingRow(codeLanding, editing);
  const table =
    `<div class="tablewrap"><table class="list"><thead><tr><th>Name</th><th>Value</th>` +
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
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/settings" class="newspecform">` +
    tokenField(opts.token) +
    (opts.error ? rowMessage("failed", opts.error, { hook: "refusal", tag: "p" }) : "") +
    // `.configactions` carries its own `flex-basis: 100%`, so it stacks
    // above the table the same way `.frow` does without needing that
    // wrapper itself (spec 301).
    `<div class="configactions">${btn({ label: "Save", variant: "primary", pending: "saving…" })}` +
    `<a class="btn" href="${esc(path)}">Cancel</a></div>` +
    `<span class="frow">${table}</span>` +
    messageSlot("refused") +
    `</form>`
  );
}
