// Spec 511: a `**Archived:**` or `**Closed:**` stamp followed by a later
// `**Round boundary:**`, `**Reopened:**` or `**Reset:**` mark is history.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specArchivedDate, specCloseReason, specClosed, specClosedDate } from "../../../src/project/discover";

const dirs: string[] = [];
function specWith(status: string): string {
  const dir = mkdtempSync(join(tmpdir(), "stamp-order-"));
  dirs.push(dir);
  writeFileSync(join(dir, "4-status.md"), status);
  return dir;
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const BOUNDARY = "- **Round boundary:** 2026-09-19 (history before `abc1234` does not count)";
const CLOSED = "- **Closed:** 2026-09-10 — not needed";

describe("the order rule for stamps", () => {
  test("a Closed stamp alone reads as closed", () => {
    const dir = specWith(`${CLOSED}\n`);
    expect(specClosed(dir)).toBe(true);
    expect(specClosedDate(dir)).toBe("2026-09-10");
    expect(specCloseReason(dir)).toBe("not needed");
  });

  test("a Closed stamp followed by a Round boundary is history AC-2", () => {
    const dir = specWith(`${CLOSED}\n${BOUNDARY}\n`);
    expect(specClosed(dir)).toBe(false);
    expect(specClosedDate(dir)).toBeNull();
    expect(specCloseReason(dir)).toBeNull();
  });

  test("a new Closed stamp after the boundary counts AC-2", () => {
    const dir = specWith(`${CLOSED}\n${BOUNDARY}\n- **Closed:** 2026-09-25 — again\n`);
    expect(specClosed(dir)).toBe(true);
    expect(specClosedDate(dir)).toBe("2026-09-25");
  });

  test("an Archived stamp followed by a Round boundary is history, and a later one counts AC-2", () => {
    const kept = specWith(`- **Archived:** 2026-09-10\n${BOUNDARY}\n`);
    expect(specArchivedDate(kept)).toBeNull();
    const again = specWith(`- **Archived:** 2026-09-10\n${BOUNDARY}\n- **Archived:** 2026-09-22\n`);
    expect(specArchivedDate(again)).toBe("2026-09-22");
  });

  test("an Archived stamp alone keeps its date", () => {
    expect(specArchivedDate(specWith("- **Archived:** 2026-09-10\n"))).toBe("2026-09-10");
  });
});
