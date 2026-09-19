import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFailedCreates, failedCreateFrom, type FailedCreate } from "../../src/push/failed-creates.ts";
import { tempDir } from "./fixtures.ts";

const rec = (n: number, over: Partial<FailedCreate> = {}): FailedCreate => ({
  id: `id-${n}`, project: "aide", title: `Title ${n}`, description: `text ${n}`,
  reason: "the step failed", failedAt: new Date(2026, 8, 19, 12, 0, n).toISOString(), ...over,
});

let tmp: ReturnType<typeof tempDir>;
afterEach(() => tmp?.done());

describe("the record of a failed create (AC-4, AC-5)", () => {
  test("lists undismissed records newest first", () => {
    tmp = tempDir();
    const s = createFailedCreates(join(tmp.dir, "f.json"));
    s.add(rec(1));
    s.add(rec(2));
    expect(s.list().map((r) => r.id)).toEqual(["id-2", "id-1"]);
  });

  test("dismissing one leaves the other, and twice is fine (AC-5)", () => {
    tmp = tempDir();
    const s = createFailedCreates(join(tmp.dir, "f.json"));
    s.add(rec(1));
    s.add(rec(2));
    expect(s.dismiss("id-2")).toBe(true);
    expect(s.dismiss("id-2")).toBe(true);
    expect(s.list().map((r) => r.id)).toEqual(["id-1"]);
    expect(s.dismiss("nope")).toBe(false);
  });

  test("a dismissed record is still retrievable by id (AC-6)", () => {
    tmp = tempDir();
    const s = createFailedCreates(join(tmp.dir, "f.json"));
    s.add(rec(1));
    s.dismiss("id-1");
    expect(s.get("id-1")?.title).toBe("Title 1");
    expect(s.get("unknown")).toBeUndefined();
  });

  test("adding the same id twice keeps one record", () => {
    tmp = tempDir();
    const s = createFailedCreates(join(tmp.dir, "f.json"));
    s.add(rec(1));
    s.add(rec(1));
    expect(s.list()).toHaveLength(1);
  });

  test("survives a new instance on the same path (AC-4)", () => {
    tmp = tempDir();
    const path = join(tmp.dir, "f.json");
    createFailedCreates(path).add(rec(1));
    expect(createFailedCreates(path).list().map((r) => r.id)).toEqual(["id-1"]);
  });

  test("keeps the newest 50 dismissed and every undismissed", () => {
    tmp = tempDir();
    const s = createFailedCreates(join(tmp.dir, "f.json"));
    s.add(rec(0));
    for (let n = 1; n <= 55; n++) {
      s.add(rec(n));
      s.dismiss(`id-${n}`);
    }
    expect(s.list().map((r) => r.id)).toEqual(["id-0"]);
    expect(s.get("id-1")).toBeUndefined();
    expect(s.get("id-5")).toBeUndefined();
    expect(s.get("id-6")).toBeDefined();
    expect(s.get("id-55")).toBeDefined();
  });
});

describe("what the file may hold (AC-4)", () => {
  test("a corrupt file reads as empty and can be written over", () => {
    tmp = tempDir();
    const path = join(tmp.dir, "f.json");
    writeFileSync(path, "{not json");
    const s = createFailedCreates(path);
    expect(s.list()).toEqual([]);
    s.add(rec(1));
    expect(createFailedCreates(path).list()).toHaveLength(1);
  });

  test("a record whose reason names a message this build lacks is dropped, the rest stay", () => {
    tmp = tempDir();
    const path = join(tmp.dir, "f.json");
    writeFileSync(path, JSON.stringify([
      rec(1, { reason: { key: "removed.long.ago" } as never }),
      rec(2, { reason: [{ key: "runner.serverRestarted", values: { button: "Create" } }, "text"] }),
      { id: "bad" },
    ]));
    expect(createFailedCreates(path).list().map((r) => r.id)).toEqual(["id-2"]);
  });

  test("with no path it keeps records in memory", () => {
    const s = createFailedCreates(undefined);
    s.add(rec(1));
    expect(s.list()).toHaveLength(1);
  });

  test("an unwritable path never throws", () => {
    tmp = tempDir();
    const dir = join(tmp.dir, "ro");
    writeFileSync(dir, "a file, not a directory");
    const s = createFailedCreates(join(dir, "f.json"));
    expect(() => s.add(rec(1))).not.toThrow();
    expect(s.list()).toHaveLength(1);
    expect(existsSync(join(dir, "f.json"))).toBe(false);
    void chmodSync;
  });
});

describe("failedCreateFrom", () => {
  test("takes project, typed text and the reason off the job", () => {
    const r = failedCreateFrom({
      id: "j1", project: "aide", createTitle: "T", createDescription: "D", error: "boom",
      finishedAt: "2026-09-19T17:05:00.000Z",
    } as never);
    expect(r).toMatchObject({ id: "j1", project: "aide", title: "T", description: "D", reason: "boom" });
    expect(r.failedAt).toBe("2026-09-19T17:05:00.000Z");
  });

  test("a job with no reason gets the generic sentence, and no title becomes empty", () => {
    const r = failedCreateFrom({ id: "j2", project: "aide" } as never);
    expect(r.reason).toEqual({ key: "runner.createEndedNoReason" });
    expect(r.title).toBe("");
    expect(r.description).toBe("");
  });
});
