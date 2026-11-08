// The Installation tab's reading: a table of where aide is installed for the
// tool, and under it a line only for what is wrong. The login is not here:
// the provider's Overview tab shows it. The check's shape is imported as a
// type only.

import { esc } from "../../ui/html.ts";
import { facts, rowMessage } from "../../ui/components";
import { t, type Language } from "../../../i18n";
import { INSTALL_TARGETS, PLACE_HOLDS } from "./places.ts";
import { TOOL_TAB_LABELS, type ToolCheck } from "./tools.ts";

/** The Installation tab's body. */
export function installationBlock(
  check: ToolCheck,
  lang: Language = "en",
): string {
  const rows = INSTALL_TARGETS.filter((row) => row.tool === check.tool).map(
    (row) => ({ ...row, to: check.paths?.[row.place] ?? row.to }),
  );
  const table = facts(
    rows.map((row) => ({
      label: esc(
        PLACE_HOLDS[row.place]
          ? t(lang, `settings.install.holds.${PLACE_HOLDS[row.place]}`)
          : row.place,
      ),
      value: esc(row.to),
    })),
  );
  const advice: string[] = [];
  if (check.error) advice.push(rowMessage("failed", check.error, { tag: "p" }));
  if (!check.found && !check.error) {
    advice.push(
      rowMessage(
        "waiting",
        t(lang, "settings.install.cliMissing", {
          tool: TOOL_TAB_LABELS[check.tool],
        }),
        { tag: "p" },
      ),
    );
  }
  const missing = rows
    .filter((row) => check.missing?.includes(row.place))
    .map((row) => row.to);
  if (missing.length) {
    advice.push(
      rowMessage(
        "waiting",
        t(lang, "settings.install.missing", { places: missing.join(", ") }),
        { tag: "p" },
      ),
    );
  }
  if (check.behind)
    advice.push(
      rowMessage("waiting", t(lang, "settings.install.behind"), { tag: "p" }),
    );
  return table + advice.join("");
}
