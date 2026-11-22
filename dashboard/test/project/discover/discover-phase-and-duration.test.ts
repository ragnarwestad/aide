// Split out of discover.test.ts by theme.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specArchivedDate } from "../../../src/project/discover";


// The archive listing needs a DATE per row, and `4-status.md`
// carries one for every spec the archive step stamped.
describe("specArchivedDate", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-archived-date-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const withStatus = (name: string, text: string): string => {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "4-status.md"), text);
    return d;
  };

  test("reads the stamp the archive step wrote", () => {
    const d = withStatus("plain", "# Status\n\n**Archived:** 2026-08-20\n");
    expect(specArchivedDate(d)).toBe("2026-08-20");
  });

  // Both shapes are on disk in aide's own archive today: the newer
  // template writes it as a Tracking-info bullet, in backticks.
  test("reads it as a Tracking info bullet, backticks and all", () => {
    const d = withStatus("bullet", "# Status\n\n## Tracking info\n\n- **Archived:** `2026-08-21`\n");
    expect(specArchivedDate(d)).toBe("2026-08-21");
  });

  test("a status file with no stamp answers null, not a blank string", () => {
    const d = withStatus("nostamp", "# Status\n\n## Tracking info\n\n- **Created:** 2026-08-01\n");
    expect(specArchivedDate(d)).toBeNull();
  });

  test("a stamp with nothing after it is no stamp", () => {
    const d = withStatus("empty", "# Status\n\n**Archived:**\n");
    expect(specArchivedDate(d)).toBeNull();
  });

  test("no 4-status.md at all answers null", () => {
    expect(specArchivedDate(join(dir, "nothing-here"))).toBeNull();
  });
});
