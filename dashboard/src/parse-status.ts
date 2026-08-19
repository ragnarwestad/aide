// 4-status.md parsing only. The progress line exists in the wild in
// several variants (measured in spec 79's analysis): progress /
// fremgang / framdrift, optional leading "- ", optional backticks,
// optional space before %, of / av, on any line. The phase is the
// first phase section whose task table has unchecked rows; all
// checked means "done".

export interface Progress {
  percent: number;
  done: number;
  total: number;
}

export interface StatusInfo {
  progress: Progress | null;
  phase: string | null;
}

const PROGRESS_RE =
  /(?:progress|fremgang|framdrift):\*\*\s*`?\s*(\d+)\s*%\s*\((\d+)\s+(?:of|av)\s+(\d+)/i;

const OPEN_MARKS = ["⬜", "🔄"];

export function parseStatus(content: string): StatusInfo {
  const m = content.match(PROGRESS_RE);
  const progress: Progress | null = m
    ? { percent: Number(m[1]), done: Number(m[2]), total: Number(m[3]) }
    : null;

  let phase: string | null = null;
  let sawPhaseSection = false;
  for (const section of content.split(/^## /m).slice(1)) {
    const heading = section.split("\n", 1)[0].trim();
    if (!/^(phase|fase)\b/i.test(heading)) continue;
    sawPhaseSection = true;
    if (OPEN_MARKS.some((mark) => section.includes(mark))) {
      phase = heading;
      break;
    }
  }
  if (sawPhaseSection && phase === null) phase = "done";

  return { progress, phase };
}

// --- spec 108: an archive run that declined -----------------------------------

/** Why the last headless archive run did NOT move the folder, or `null`
 *  when nothing is holding it back.
 *
 *  A finished archive JOB says nothing about whether anything was
 *  archived: the runner's `ok` flag is the claude session's own exit
 *  status, and a skill that reads an unfinished `4-status.md` and
 *  declines exits just as successfully as one that moved the folder.
 *  So the skill writes the reason where it can be re-read — a
 *  `## Archive held back` section in the spec's own status file — and
 *  this reads it back. Same technique as `discover.ts`'s
 *  `specDescription` (find the heading, slice to the next heading or
 *  `---`), with `parseStatus`'s calling convention: the content, not a
 *  directory, because the caller already has the file in hand.
 *
 *  The LAST such section wins. A spec declined twice carries its
 *  current reason, not the one an earlier attempt gave. */
const ARCHIVE_HELD_BACK_RE = /^##\s+Archive held back\s*$/gm;

export function archiveHeldBackReason(content: string): string | null {
  const matches = [...content.matchAll(ARCHIVE_HELD_BACK_RE)];
  const m = matches[matches.length - 1];
  if (!m || m.index === undefined) return null;
  const body = content.slice(m.index + m[0].length);
  const end = body.search(/^#{1,6}\s|^---\s*$/m);
  const section = (end === -1 ? body : body.slice(0, end)).trim();
  return section.split("\n")[0]?.replace(/^[-*]\s*/, "").trim() || null;
}
