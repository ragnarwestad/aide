// A fixture can say what its row must show once the round is over, and
// tighten its own time limit — both read from `<slug>.json` beside the
// description, and both optional: a fixture that says nothing about
// its row is checked on archived/not-archived alone, as before.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFixtures } from "../../src/serve/handle-queue/self-run.ts";

test("a fixture's expect and timeoutSec are read; a fixture without them carries neither", () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-round-fixtures-"));
  try {
    writeFileSync(
      join(dir, "01-plain.json"),
      JSON.stringify({ title: "Plain", steps: ["analyze"], expected: "not-archived" }),
    );
    writeFileSync(join(dir, "01-plain.md"), "Plain.\n");
    writeFileSync(
      join(dir, "02-slow.json"),
      JSON.stringify({
        title: "Slow",
        steps: ["analyze", "implement"],
        expected: "not-archived",
        timeoutSec: 10,
        expect: { state: "stopped", stopReason: "timeout", message: "time limit" },
      }),
    );
    writeFileSync(join(dir, "02-slow.md"), "Slow.\n");

    const [plain, slow] = readFixtures(dir);
    expect(plain).toEqual({ slug: "01-plain", title: "Plain", steps: ["analyze"], expected: "not-archived", dependsOn: [] });
    expect(slow).toEqual({
      slug: "02-slow",
      title: "Slow",
      steps: ["analyze", "implement"],
      expected: "not-archived",
      dependsOn: [],
      timeoutSec: 10,
      expect: { state: "stopped", stopReason: "timeout", message: "time limit" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every checked-in fixture's expect names a state the store knows", () => {
  const fixtures = readFixtures(join(import.meta.dir, "..", "round", "specs"));
  expect(fixtures.length).toBeGreaterThanOrEqual(12);
  for (const f of fixtures) {
    if (!f.expect?.state) continue;
    expect(["queued", "running", "done", "stopped", "failed", "cancelled"]).toContain(f.expect.state);
  }
});
