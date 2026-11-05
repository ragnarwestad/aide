// What a command printed, cut for the (?) behind a board message: whole
// lines, never a byte count, without colour codes, carriage returns or
// blank lines. The end of the output, where a command says why it failed.

/** The last `max` clean lines of `said`, joined. Empty when it said nothing. */
export function outputTail(said: string, max = 8): string {
  return said
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .split(/\r\n|\r|\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .slice(-max)
    .join("\n");
}
