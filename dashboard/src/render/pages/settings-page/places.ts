// Where aide installs for each AI, read from the one table that says so.
// `core/scripts/aide-preflight` prints the same rows, so the sentence on an
// AI's tab and the check's own output name the same places.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface InstallTarget {
  tool: string;
  /** The place's name, as the tab's sentence fills it in. */
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
    if (fields.length !== 4) throw new Error(`install-targets.txt: not four fields: ${line.trim()}`);
    const [tool, place, from, to] = fields as [string, string, string, string];
    rows.push({ tool, place, from, to });
  }
  return rows;
}

/** core/scripts/lib/install-targets.txt, read once at load, as the
 *  stylesheet is. */
export const INSTALL_TARGETS = parseInstallTargets(
  readFileSync(join(import.meta.dir, "../../../../../core/scripts/lib/install-targets.txt"), "utf-8"),
);

/** One AI's places by name: { skills: "~/.claude/skills/", … }. */
export function placesOf(targets: InstallTarget[], tool: string): Record<string, string> {
  return Object.fromEntries(targets.filter((row) => row.tool === tool).map((row) => [row.place, row.to]));
}
