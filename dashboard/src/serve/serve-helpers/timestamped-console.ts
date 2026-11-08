// Every line the served dashboard writes to its log carries the moment
// it was written. The log is what a reader has when a board died or a
// landing went wrong hours ago, and a line with no clock cannot be put
// beside the queue's own timestamps or the install log's.

/** `line` with an ISO timestamp in front: "2026-09-14T09:37:22.000Z queue: …". */
export function stampLine(line: string, now: () => Date = () => new Date()): string {
  return `${now().toISOString()} ${line}`;
}

/** Wraps `console.log` and `console.error` so every line they write is
 *  stamped. Returns a function that puts the originals back. */
export function installTimestampedConsole(now: () => Date = () => new Date()): () => void {
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]) => log(stampLine(args.map(String).join(" "), now));
  console.error = (...args: unknown[]) => error(stampLine(args.map(String).join(" "), now));
  return () => {
    console.log = log;
    console.error = error;
  };
}
