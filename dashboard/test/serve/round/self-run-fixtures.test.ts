// A fixture can say what its row must show once the round is over, and
// tighten its own time limit — both read from `<slug>.json` beside the
// description, and both optional: a fixture that says nothing about
// its row is checked on archived/not-archived alone, as before.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCreateRequest } from "../../../src/queue/queue.ts";
import { createEnd, fixtureCreateBody, fixtureOrder, jobSettled, readFixtures, type RoundSpec } from "../../../src/serve/routes/self-run.ts";

const FIXTURES = join(import.meta.dir, "..", "..", "round", "specs");

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
  const fixtures = readFixtures(join(import.meta.dir, "..", "..", "round", "specs"));
  expect(fixtures.length).toBeGreaterThanOrEqual(11);
  for (const f of fixtures) {
    if (!f.expect?.state) continue;
    expect(["queued", "running", "done", "stopped", "failed", "cancelled"]).toContain(f.expect.state);
  }
});

// A fixture is created the way New spec creates a spec by default. Left
// out, the create parser reads acceptance ticking as not required, and
// the fixture about an unticked row showed no hold on the test board.
test("a fixture's create asks for acceptance ticking, as New spec does by default", () => {
  const spec = { slug: "06-an-unticked-acceptance-row", title: "An unticked acceptance row", steps: ["analyze"], expected: "not-archived", dependsOn: [] };
  const parsed = parseCreateRequest(fixtureCreateBody("aide-test", spec, "Rows.\n", []), {
    allow: () => true,
    defaults: { timeoutSec: { default: 60 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.job.acceptanceNotRequired).toBeUndefined();
});

// The round creates its fixtures one at a time, in their own order, each
// after the one before has its number (2026-09-25) — so a board built
// twice numbers every fixture the same and ends in the same states.
describe("the order the round creates its fixtures in", () => {
  const spec = (slug: string, dependsOn: string[] = []) =>
    ({ slug, title: slug, steps: ["create"], expected: "done", dependsOn }) as RoundSpec;

  test("is the fixtures' own order", () => {
    const specs = [spec("01-a"), spec("02-b"), spec("03-c", ["01"])];
    expect(fixtureOrder(specs).map((s) => s.slug)).toEqual(["01-a", "02-b", "03-c"]);
  });

  test("a fixture that depends on one listed after it is refused by name", () => {
    expect(() => fixtureOrder([spec("01-a", ["02"]), spec("02-b")])).toThrow("01-a depends on 02-b, which comes after it");
  });

  test("a dependency with no fixture at all is refused by name", () => {
    expect(() => fixtureOrder([spec("01-a", ["09"])])).toThrow("no fixture found for dependency 09 of 01-a");
  });

  test("every checked-in fixture can be created in its own order", () => {
    expect(() => fixtureOrder(readFixtures(FIXTURES))).not.toThrow();
  });
});

// A fixture can be about a create that ends without a spec: the round
// records that it failed and goes on to the next fixture.
describe("what a fixture's create has come to", () => {
  const spec = (expected: string) =>
    ({ slug: "13-a-create-that-fails", title: "A create that fails", steps: ["analyze"], expected, dependsOn: [] }) as RoundSpec;

  test("a create meant to fail that failed is recorded as failed", () => {
    expect(createEnd(spec("create-failed"), { specFolder: "new-abcdef12", state: "failed" })).toEqual({ failed: true });
  });

  test("a create meant to fail that made a spec is refused by name", () => {
    expect(() => createEnd(spec("create-failed"), { specFolder: "13-a-create-that-fails", state: "done" })).toThrow(
      "13-a-create-that-fails was meant to fail its create, and made 13-a-create-that-fails",
    );
  });

  test("a create that failed when it was not meant to is refused by name", () => {
    expect(() => createEnd(spec("archived"), { specFolder: "new-abcdef12", state: "failed" })).toThrow(
      "create failed for 13-a-create-that-fails",
    );
  });

  test("a landed create gives its folder, and one still going gives nothing yet", () => {
    expect(createEnd(spec("archived"), { specFolder: "13-a-create", state: "done" })).toEqual({ folder: "13-a-create" });
    expect(createEnd(spec("archived"), { specFolder: "new-abcdef12", state: "running" })).toBeUndefined();
    expect(createEnd(spec("create-failed"), { specFolder: "new-abcdef12", state: "running" })).toBeUndefined();
  });
});

// A fixture whose create must reach the model says so with `aiCreate`:
// without it the board makes the folder itself, as New spec does with
// "let AI formulate acceptance criteria" cleared.
test("a fixture with aiCreate asks for the create through the model, and one without does not", () => {
  const parse = (spec: RoundSpec) =>
    parseCreateRequest(fixtureCreateBody("aide-test", spec, "Text.\n", []), {
      allow: () => true,
      defaults: { timeoutSec: { default: 60 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    });
  const plain = { slug: "01-a", title: "A", steps: ["analyze"], expected: "archived", dependsOn: [] } as RoundSpec;
  const viaModel = parse({ ...plain, aiCreate: true });
  const mechanical = parse(plain);
  expect(viaModel.ok && mechanical.ok).toBe(true);
  if (!viaModel.ok || !mechanical.ok) return;
  expect(viaModel.job.createNoAiFormulate).toBeUndefined();
  expect(mechanical.job.createNoAiFormulate).toBe(true);
});

test("a fixture's aiCreate is read from its json", () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-round-fixtures-"));
  try {
    writeFileSync(join(dir, "01-a.json"), JSON.stringify({ title: "A", steps: ["analyze"], expected: "create-failed", aiCreate: true }));
    writeFileSync(join(dir, "01-a.md"), "A.\n");
    expect(readFixtures(dir)[0]?.aiCreate).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A fixture can wait for another fixture's job to settle before its own
// steps are queued: `after` names the other by the number in its file
// name, the way `dependsOn` does.
describe("a fixture that waits for another's job", () => {
  const spec = (slug: string, after?: string) =>
    ({ slug, title: slug, steps: ["analyze"], expected: "done", dependsOn: [], ...(after ? { after } : {}) }) as RoundSpec;

  test("reads after from the fixture's json", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-round-after-"));
    try {
      writeFileSync(join(dir, "01-first.json"), JSON.stringify({ title: "First", steps: ["analyze"], expected: "not-archived" }));
      writeFileSync(join(dir, "02-second.json"), JSON.stringify({ title: "Second", steps: ["analyze"], expected: "not-archived", after: "01" }));
      expect(readFixtures(dir).map((s) => s.after)).toEqual([undefined, "01"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("one that waits for a fixture listed after it is refused by name", () => {
    expect(() => fixtureOrder([spec("01-a", "02"), spec("02-b")])).toThrow("01-a waits for 02-b, which comes after it");
  });

  test("one that waits for no fixture at all is refused by name", () => {
    expect(() => fixtureOrder([spec("01-a", "09")])).toThrow("no fixture found for 09, which 01-a waits for");
  });

  test("the other's job has settled once it is neither queued, running nor landing", () => {
    const job = (state: string, landing = false) => ({ specFolder: "05-x", state, ...(landing ? { landing } : {}) });
    expect(jobSettled([], "05-x")).toBe(false);
    expect(jobSettled([job("queued")], "05-x")).toBe(false);
    expect(jobSettled([job("running")], "05-x")).toBe(false);
    expect(jobSettled([job("done", true)], "05-x")).toBe(false);
    expect(jobSettled([job("done")], "05-x")).toBe(true);
    expect(jobSettled([job("stopped")], "05-x")).toBe(true);
    expect(jobSettled([{ ...job("done"), specFolder: "06-y" }], "05-x")).toBe(false);
    // The create job carries the folder too, and is done long before the
    // job with the fixture's own steps.
    expect(jobSettled([job("done"), job("running")], "05-x")).toBe(false);
    expect(jobSettled([job("done"), job("done")], "05-x")).toBe(true);
  });
});
