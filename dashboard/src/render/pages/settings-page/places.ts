// Where aide installs for each AI, read from the one table that says so.
// `core/scripts/aide-preflight` reads the same rows, so the Installation
// tab and the check's facts name the same places.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface InstallTarget {
  tool: string;
  /** The place's name. */
  place: string;
  /** The path in the repository, or "-" when nothing is copied. */
  from: string;
  /** Where it lands, written from `~/`. */
  to: string;
}

/** The table's rows; a blank line or one starting with # is skipped, and a
 *  line without four fields throws, naming the line. */
export function parseInstallTargets(text: string): InstallTarget[] {
  const rows: InstallTarget[] = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/).filter(Boolean);
    if (!fields.length || fields[0]!.startsWith("#")) continue;
    if (fields.length !== 4)
      throw new Error(`install-targets.txt: not four fields: ${line.trim()}`);
    const [tool, place, from, to] = fields as [string, string, string, string];
    rows.push({ tool, place, from, to });
  }
  return rows;
}

/** core/scripts/lib/install-targets.txt, read once at load, as the
 *  stylesheet is. */
export const INSTALL_TARGETS = parseInstallTargets(
  readFileSync(
    join(
      import.meta.dir,
      "../../../../../core/scripts/lib/install-targets.txt",
    ),
    "utf-8",
  ),
);

/** What a place holds, which the Installation tab labels it with: the
 *  five labels `settings.install.holds.<label>` says. */
export type PlaceHolds =
  "instructions" | "rules" | "skills" | "scripts" | "hooks";

/** What each place name in the table holds. */
export const PLACE_HOLDS: Record<string, PlaceHolds> = {
  instructions: "instructions",
  rules: "rules",
  skills: "skills",
  claudeSkills: "skills",
  scripts: "scripts",
  hookConfig: "hooks",
  hooks: "hooks",
};
