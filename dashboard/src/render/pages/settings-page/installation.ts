// The Installation tab's reading: what the check found — the preflight's
// own lines and every command the check ran. The login is not here: the
// provider's Overview tab shows it. The check's shape is imported as a
// type only.

import { esc } from "../../ui/html.ts";
import { rowMessage } from "../../ui/components";
import { t, type Language } from "../../../i18n";
import type { ToolCheck } from "./tools.ts";

/** The Installation tab's body. `checkedAt` is the check's time as the tab
 *  stamps it. */
export function installationBlock(check: ToolCheck, checkedAt: string, lang: Language = "en"): string {
  if (check.error) {
    return rowMessage("failed", check.error, { tag: "p" });
  }
  const ran = check.commands?.length
    ? `<p class="muted small">${esc(t(lang, "settings.install.ran"))}</p><pre class="checkoutput">${esc(check.commands.join("\n"))}</pre>`
    : "";
  return (
    `<p class="muted small">${esc(t(lang, "settings.install.checkedAt", { at: checkedAt }))}</p>` +
    ran +
    `<pre class="checkoutput">${esc(check.lines.join("\n"))}</pre>`
  );
}
