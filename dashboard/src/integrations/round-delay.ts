// How long a test board's stand-in model waits before each step, so a
// row stays in each state long enough to be watched. The value is a bare
// number of seconds in a file `test/round/run` names in
// `AIDE_ROUND_DELAY_FILE`; `test/round/claude-stub` reads it at the start
// of every step, so a press takes effect at the next step.

import { readFileSync, writeFileSync } from "node:fs";

/** Off, then the waits a press steps through, in order. */
export const DELAY_CHOICES = [0, 10, 30, 60] as const;

/** The file the stand-in reads, or none on a board the round did not start. */
export function delayFile(): string | undefined {
  return process.env.AIDE_ROUND_DELAY_FILE || undefined;
}

/** The current wait; off when the file is missing or holds no choice. */
export function readDelay(file: string): number {
  try {
    const n = Number(readFileSync(file, "utf8").trim());
    return (DELAY_CHOICES as readonly number[]).includes(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** The choice after `current`, back to off after the last. */
export function nextDelay(current: number): number {
  const at = (DELAY_CHOICES as readonly number[]).indexOf(current);
  return DELAY_CHOICES[(at + 1) % DELAY_CHOICES.length]!;
}

/** False, and the file left alone, for a value that is not a choice. */
export function writeDelay(file: string, seconds: number): boolean {
  if (!(DELAY_CHOICES as readonly number[]).includes(seconds)) return false;
  writeFileSync(file, `${seconds}\n`);
  return true;
}
