// The specs a stopped analysis recorded as sharing its files, as
// `core/scripts/aide-spec-overlap` writes them under `### Overlapping specs`
// in the newest round of 2-analysis.md, and which of them are still open.
// The bash reader and this one are a pair (docs/bash-typescript-decisions.md).

import type { SharedFiles } from "../queue/types.ts";
import type { SpecRef } from "./discover";
import { specFileText } from "./discover";
import { specNumber } from "./spec-folder.ts";

/** A spec the record names that is still open: what a reader recognises it by, and the files it shares. */
export interface OpenOverlap {
  folder: string;
  /** `<number> <title>`, or the whole folder when its description has no title. */
  label: string;
  files: string[];
}

const ROUND = /^## Round [0-9]+/;
const ANY_HEADING = /^#+ /;
const RECORD_LINE = /^\s*-\s*`([^`]+)`(.*)$/;

/** A path as the record writes it: less a leading `./` and a trailing `:<line>` or `:<from>-<to>`. */
const barePath = (p: string): string => p.replace(/^\.\//, "").replace(/:[0-9]+(-[0-9]+)?$/, "");

/** The newest round's `### Overlapping specs` record: one `{spec, files}` per line,
 *  `- \`<spec>\` — \`<file>\`, \`<file>\``. Read as `record_json`, `newest_round`
 *  and `section` in core/scripts/aide-spec-overlap read it: from the last
 *  `## Round N` line to the end, up to the next heading of any level. */
export function overlappingSpecsIn(analysis: string): SharedFiles[] {
  const lines = analysis.split("\n");
  let from = 0;
  lines.forEach((line, i) => {
    if (ROUND.test(line)) from = i;
  });
  const record: SharedFiles[] = [];
  let on = false;
  for (const line of lines.slice(from)) {
    if (line === "### Overlapping specs") {
      on = true;
      continue;
    }
    if (ANY_HEADING.test(line)) on = false;
    if (!on) continue;
    const m = RECORD_LINE.exec(line);
    if (!m) continue;
    const files = [...m[2]!.matchAll(/`([^`]+)`/g)].map((f) => barePath(f[1]!));
    record.push({ spec: m[1]!, files });
  }
  return record;
}

/** The specs the record in `dir`'s 2-analysis.md names that are still open:
 *  known to the scan and not under `archive/` (archived or closed). Undefined
 *  when there is no record to read — no folder, no file, or no line under the
 *  heading — so a caller can tell "names none" from "all archived" ([]). */
export function openOverlappingSpecs(
  dir: string | undefined,
  refOf: (folder: string) => SpecRef | undefined,
): OpenOverlap[] | undefined {
  if (!dir) return undefined;
  const text = specFileText(dir, "2-analysis.md");
  if (text === null) return undefined;
  const record = overlappingSpecsIn(text);
  if (!record.length) return undefined;
  const open: OpenOverlap[] = [];
  for (const { spec, files } of record) {
    const ref = refOf(spec);
    if (!ref || ref.archived || ref.closed) continue;
    open.push({ folder: spec, label: ref.title ? `${specNumber(spec)} ${ref.title}` : spec, files });
  }
  return open;
}
