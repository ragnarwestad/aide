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
