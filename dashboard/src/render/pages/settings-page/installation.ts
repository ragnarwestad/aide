// The Installation tab of an AI: what the last check found — the preflight's
// own lines, every command the check ran, and the answers it asked for
// beside them. Declared apart from `tools.ts`, which draws the tab around
// it; the check's shape is imported as a type only.

import { esc } from "../../ui/html.ts";
import { rowMessage } from "../../ui/components";
import { capitalizeFirst } from "../../ui/job-state/provider-limit.ts";
import { renderSentence } from "../../../i18n/message.ts";
import type { Language } from "../../../i18n";
import type { ExtraCheck, ToolCheck } from "./tools.ts";

const mark = (ok: boolean | null): string =>
  ok === null ? "?" : ok ? "OK" : "FAIL";

const markClass = (ok: boolean | null): string =>
  ok === null ? "muted" : ok ? "ok" : "failed";

/** One answer of the check. An entry that carries its answer as a sentence
 *  is that sentence alone, in the reader's language, with what follows it
 *  as a sentence of its own: the sentence already says yes or no, so a
 *  mark and a question in front of it would say it twice. */
function entryLine(e: ExtraCheck, lang: Language): string {
  if (e.answer) {
    return `<li>${esc(capitalizeFirst(renderSentence(lang, e.detail ? [e.answer, e.detail] : e.answer) ?? ""))}</li>`;
  }
  return `<li><span class="${markClass(e.ok)}">${mark(e.ok)}</span> ${esc(e.question)} ${esc(e.detail)}</li>`;
}

/** The Installation tab's body. `checkedAt` is the check's time as the tab
 *  stamps it. */
export function installationBlock(check: ToolCheck | undefined, checkedAt: string, lang: Language = "en"): string {
  if (!check) return `<p class="muted">Not checked yet.</p>`;
  if (check.error) {
    return rowMessage("failed", check.error, { tag: "p" });
  }
  const extra = check.extra.length
    ? `<ul class="checklist">${check.extra.map((e) => entryLine(e, lang)).join("")}</ul>`
    : "";
  const ran = check.commands?.length
    ? `<p class="muted small">Ran:</p><pre class="checkoutput">${esc(check.commands.join("\n"))}</pre>`
    : "";
  return (
    `<p class="muted small">Checked ${esc(checkedAt)}</p>` +
    extra +
    ran +
    `<pre class="checkoutput">${esc(check.lines.join("\n"))}</pre>`
  );
}
