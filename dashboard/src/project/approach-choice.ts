// The approaches a spec's analysis weighed, as `3-solution.md` names them
// when the spec asked to choose between them ("Let me choose the
// approach"): each approach's bold lead ends in one of three marks, and
// the board writes the person's pick as a line of its own under the
// Approaches heading. The one reader of that format — the runner reads
// none of it, and the analyze skill reads the file as text.
//
//   **Chosen approach:** Approach B
//
//   **Approach A: Hold the chained implement (recommended).** ...
//   **Approach B: End the job after analyze (real alternative).** ...
//   **Approach C: Hold every implement (considered and rejected).** ...
//
// Only the newest round counts: with `## Round N` sections, the leads and
// the chosen line are read from the last one, so a choice made in an
// earlier round does not answer a new round's approaches.

import { chooseApproachIn, specFileText } from "./discover";

export const APPROACH_MARKS = ["recommended", "real alternative", "considered and rejected"] as const;
export type ApproachMark = (typeof APPROACH_MARKS)[number];

export interface Approach {
  letter: string;
  title: string;
  mark: ApproachMark;
}

export interface ApproachChoice {
  approaches: Approach[];
  /** The letter of the chosen line, when the newest round has one. */
  chosen?: string;
}

const ROUND = /^## Round \d/;
const FENCE = /^(```|~~~)/;
const APPROACHES_HEADING = /^(#{2,6})[ \t]+Approaches[ \t]*$/i;
const HEADING = /^(#{1,6})[ \t]/;
// `[ \t]`, never `\s`, in the line patterns: `\s` matches a newline.
const LEAD = /^\*\*Approach ([A-Z]):[ \t]+(.+?)[ \t]+\((recommended|real alternative|considered and rejected)\)\.?\*\*/;
const CHOSEN = /^\*\*Chosen approach:\*\*[ \t]+Approach ([A-Z])[ \t]*$/;

/** Where the newest round's Approaches section is, as line indexes: the
 *  heading's line, and the line after its last. Code blocks are skipped,
 *  so an example in one is never read as the spec's own section. */
function approachesSection(lines: string[]): { heading: number; end: number } | null {
  let fence = false;
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i]!)) fence = !fence;
    else if (!fence && ROUND.test(lines[i]!)) start = i;
  }
  fence = false;
  for (let i = start; i < lines.length; i++) {
    if (FENCE.test(lines[i]!)) {
      fence = !fence;
      continue;
    }
    const m = fence ? null : lines[i]!.match(APPROACHES_HEADING);
    if (!m) continue;
    const level = m[1]!.length;
    let end = i + 1;
    let inner = false;
    for (; end < lines.length; end++) {
      if (FENCE.test(lines[end]!)) inner = !inner;
      const h = inner ? null : lines[end]!.match(HEADING);
      if (h && h[1]!.length <= level) break;
    }
    return { heading: i, end };
  }
  return null;
}

/** The section's paragraphs, each joined into one line: a lead wrapped
 *  over two lines is still one lead. Lines inside a code block are left
 *  out. */
function paragraphs(lines: string[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let fence = false;
  const flush = (): void => {
    if (current.length) out.push(current.join(" "));
    current = [];
  };
  for (const line of lines) {
    if (FENCE.test(line)) {
      flush();
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (line.trim() === "") flush();
    else current.push(line.trim());
  }
  flush();
  return out;
}

/** Every marked lead and the chosen line of the newest round of a
 *  `3-solution.md`. A lead without a mark is not an approach to offer. */
export function parseApproaches(solution: string): ApproachChoice {
  const lines = solution.replace(/\r\n/g, "\n").split("\n");
  const section = approachesSection(lines);
  if (!section) return { approaches: [] };
  const approaches: Approach[] = [];
  let chosen: string | undefined;
  for (const p of paragraphs(lines.slice(section.heading + 1, section.end))) {
    const lead = p.match(LEAD);
    if (lead && !approaches.some((a) => a.letter === lead[1])) {
      approaches.push({ letter: lead[1]!, title: lead[2]!, mark: lead[3] as ApproachMark });
      continue;
    }
    const pick = p.match(CHOSEN);
    if (pick) chosen ??= pick[1];
  }
  return chosen ? { approaches, chosen } : { approaches };
}

/** The real alternatives (recommended or real alternative) waiting for a
 *  choice: the spec asked to choose, two or more are real, and none is
 *  chosen. Null otherwise. */
export function pendingChoice(optedIn: boolean, parsed: ApproachChoice): Approach[] | null {
  if (!optedIn || parsed.chosen) return null;
  const real = parsed.approaches.filter((a) => a.mark !== "considered and rejected");
  return real.length >= 2 ? real : null;
}

/** The solution with `letter` recorded as the chosen approach: a
 *  paragraph of its own directly under the newest round's Approaches
 *  heading, replacing a chosen line already there. Unchanged when the
 *  solution has no Approaches section. */
export function withChosenApproach(solution: string, letter: string): string {
  const lines = solution.replace(/\r\n/g, "\n").split("\n");
  const section = approachesSection(lines);
  if (!section) return solution;
  const body = lines.slice(section.heading + 1, section.end);
  // The old chosen line goes, with the blank line that followed it.
  const at = body.findIndex((line) => CHOSEN.test(line.trim()));
  if (at >= 0) body.splice(at, body[at + 1]?.trim() === "" ? 2 : 1);
  while (body.length && body[0]!.trim() === "") body.shift();
  return [
    ...lines.slice(0, section.heading + 1),
    "",
    `**Chosen approach:** Approach ${letter}`,
    "",
    ...body,
    ...lines.slice(section.end),
  ].join("\n");
}

/** The pending choice of the spec in `dir`, read off its own files: its
 *  description's `Let me choose the approach:` line and the approaches in
 *  `branch` (its open branch's `3-solution.md`, when that has been read)
 *  or else the checkout's. The solution is not read for a spec that did
 *  not ask. */
export function specPendingChoice(dir: string, branch?: ApproachChoice): Approach[] | null {
  if (!chooseApproachIn(specFileText(dir, "1-description.md") ?? "")) return null;
  return pendingChoice(true, branch ?? parseApproaches(specFileText(dir, "3-solution.md") ?? ""));
}
