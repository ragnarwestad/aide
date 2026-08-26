// Criterion 2 (spec 80): the run store validates the written-down
// payload schema, keys on sessionId, mirrors to a JSON file and
// reloads it on boot; unknown fields are ignored, not rejected.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AideRunStore, parseAideRun } from "../src/queue/aide-run-store.ts";

const valid = {
  host: "laptop",
  sessionId: "abc-123",
  command: "implement" as const,
  spec: "80",
  project: "aide",
  capturedAt: "2026-08-16T10:00:00Z",
};

describe("parseAideRun (schema)", () => {
  test("accepts a valid payload", () => {
    const r = parseAideRun(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run.spec).toBe("80");
  });

  test("rejects a missing command and a bad sessionId", () => {
    expect(parseAideRun({ ...valid, command: undefined }).ok).toBe(false);
    expect(parseAideRun({ ...valid, sessionId: "a/b" }).ok).toBe(false);
    expect(parseAideRun({ ...valid, command: "rm-rf" }).ok).toBe(false);
  });

  // Criterion 10 (spec 81, slice 81c): an /aide-implement run reports
  // its TDD phase from inside the step. Same row, same session — the
  // phase is what moves.
  test("accepts a TDD phase, and refuses an invented one", () => {
    const r = parseAideRun({ ...valid, phase: "green" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run.phase).toBe("green");
    expect(parseAideRun({ ...valid, phase: "deploy" }).ok).toBe(false);
  });

  test("a later phase replaces the row rather than adding one", () => {
    const store = new AideRunStore();
    const red = parseAideRun({ ...valid, phase: "red" });
    const green = parseAideRun({ ...valid, phase: "green" });
    if (!red.ok || !green.ok) throw new Error("fixtures must parse");
    store.put(red.run, "2026-08-16T10:00:00Z");
    store.put(green.run, "2026-08-16T10:05:00Z");
    expect(store.list().length).toBe(1);
    expect(store.list()[0]!.phase).toBe("green");
  });

  test("ignores unknown fields", () => {
    const r = parseAideRun({ ...valid, prompt: "secret text" });
    expect(r.ok).toBe(true);
    if (r.ok) expect("prompt" in r.run).toBe(false);
  });

  test("spec and project are optional", () => {
    const r = parseAideRun({ host: "h", sessionId: "s", command: "explore" });
    expect(r.ok).toBe(true);
  });
});

describe("AideRunStore", () => {
  test("keys on sessionId, later command replaces the row", () => {
    const store = new AideRunStore();
    store.put({ ...valid }, "2026-08-16T10:00:00Z");
    store.put({ ...valid, command: "archive" as const }, "2026-08-16T11:00:00Z");
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].command).toBe("archive");
  });

  test("LRU cap evicts the oldest", () => {
    const store = new AideRunStore({ cap: 2 });
    store.put({ ...valid, sessionId: "s1" }, "t1");
    store.put({ ...valid, sessionId: "s2" }, "t2");
    store.put({ ...valid, sessionId: "s3" }, "t3");
    expect(store.list().map((r) => r.sessionId).sort()).toEqual(["s2", "s3"]);
  });

  // Spec 210: the store has been written to since spec 80 and read only
  // as a whole list. A page asking "which third is this ONE run in?" has
  // the session id in hand and nothing to look it up with.
  describe("get", () => {
    test("returns the stored run for a session it knows", () => {
      const store = new AideRunStore();
      store.put({ ...valid, phase: "green" as const }, "2026-08-23T10:00:00Z");
      expect(store.get("abc-123")?.phase).toBe("green");
      expect(store.get("abc-123")?.command).toBe("implement");
    });

    test("returns undefined for a session it does not know", () => {
      const store = new AideRunStore();
      store.put({ ...valid }, "2026-08-23T10:00:00Z");
      expect(store.get("no-such-session")).toBeUndefined();
    });

    test("answers with the LATEST report for a session, not the first", () => {
      // The row is keyed on the session and a later phase replaces the
      // earlier one — which is the whole mechanism the page leans on to
      // watch a run advance red - green - refactor.
      const store = new AideRunStore();
      store.put({ ...valid, phase: "red" as const }, "2026-08-23T10:00:00Z");
      store.put({ ...valid, phase: "refactor" as const }, "2026-08-23T10:40:00Z");
      expect(store.get("abc-123")?.phase).toBe("refactor");
    });
  });

  test("mirrors to a file and reloads on boot", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-runs-"));
    const mirror = join(dir, "runs.json");
    try {
      const store = new AideRunStore({ mirrorPath: mirror });
      store.put({ ...valid }, "2026-08-16T10:00:00Z");
      expect(existsSync(mirror)).toBe(true);

      const reborn = new AideRunStore({ mirrorPath: mirror });
      expect(reborn.list()).toHaveLength(1);
      expect(reborn.list()[0].sessionId).toBe("abc-123");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
