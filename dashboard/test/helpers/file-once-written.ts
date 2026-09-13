// Waits for a file a fake runner writes — and for its CONTENT, not just
// its existence. A shell `>` creates the file before the first byte
// lands, so a helper that returned on existence handed back "" under
// load and stopped a landing on a test that had nothing to say
// (2026-09-13). Every stub these tests spawn writes whole lines, so a
// file is "written" once it ends in a newline.
import { readFileSync } from "node:fs";

export async function fileOnceWritten(path: string, what: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
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
