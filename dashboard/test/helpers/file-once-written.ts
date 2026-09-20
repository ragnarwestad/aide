// Waits for a file a fake runner writes — and for its CONTENT, not just
// its existence. A shell `>` creates the file before the first byte
// lands, so a helper that returned on existence handed back "" under
// load and stopped a landing on a test that had nothing to say
// (2026-09-13). Every stub these tests spawn writes whole lines, so a
// file is "written" once it ends in a newline.
import { readFileSync } from "node:fs";

/** 200 x 50 ms: the ten seconds a stub gets to write its first line. */
export const FILE_WAIT_TRIES = 200;

export async function fileOnceWritten(
  path: string,
  what: string,
  tries: number = FILE_WAIT_TRIES,
): Promise<string> {
  for (let i = 0; i < tries; i++) {
    let text: string | undefined;
    try {
      text = readFileSync(path, "utf-8");
    } catch {
      text = undefined;
    }
    if (text !== undefined && text.endsWith("\n")) return text;
    await Bun.sleep(50);
  }
  throw new Error(what);
}
