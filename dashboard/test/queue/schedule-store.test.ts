import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduleStore, parseScheduleEntries } from "../../src/queue/schedule-store.ts";
import { scheduleNotifyOf, type ScheduleEntry } from "../../src/queue/schedule.ts";

let dir: string;
let file: string;
let errors: ReturnType<typeof spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "schedule-store-"));
  file = join(dir, "queue-config.json");
  errors = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

const entry = (over: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true, ...over,
});

describe("parseScheduleEntries", () => {
  test("a valid entry parses, enabled defaulting true", () => {
    expect(parseScheduleEntries([{ name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md" }])).toEqual([entry()]);
  });

  test("a bad entry is dropped and the others kept", () => {
    const out = parseScheduleEntries([
      { name: "a", cron: "not-a-cron", prompt: "docs/a.md" },
      { name: "b", cron: "0 4 * * 0", prompt: "docs/b.md" },
      { name: "c b", cron: "0 4 * * 0", prompt: "docs/c.md" },
      { name: "d", cron: "0 4 * * 0" },
      "text",
    ]);
    expect(out.map((e) => e.name)).toEqual(["b"]);
  });

  test("a prompt that escapes the project root drops the entry", () => {
    for (const prompt of ["../../etc/passwd", "/etc/passwd", "a/../../b"]) {
      expect(parseScheduleEntries([{ name: "n", cron: "0 3 * * *", prompt }])).toEqual([]);
    }
    expect(parseScheduleEntries([{ name: "n", cron: "0 3 * * *", prompt: "docs/../docs/n.md" }])).toHaveLength(1);
  });

  test("only the literal false disables", () => {
    const base = { name: "n", cron: "0 3 * * *", prompt: "p.md" };
    expect(parseScheduleEntries([{ ...base, enabled: false }])[0]!.enabled).toBe(false);
    expect(parseScheduleEntries([{ ...base, enabled: "no" }])[0]!.enabled).toBe(true);
  });

  test("an unusable model or since drops the field, never the entry", () => {
    const [e] = parseScheduleEntries([
      { name: "n", cron: "0 3 * * *", prompt: "p.md", model: "not a model", since: "not a date" },
    ]);
    expect(e).toEqual({ name: "n", cron: "0 3 * * *", prompt: "p.md", enabled: true });
    const [f] = parseScheduleEntries([
      { name: "n", cron: "0 3 * * *", prompt: "p.md", model: "Sonnet", since: "2026-09-14T16:42:00.000Z" },
    ]);
    expect(f!.model).toBe("Sonnet");
    expect(f!.since).toBe("2026-09-14T16:42:00.000Z");
  });

  test("anything but a list is no entries", () => {
    expect(parseScheduleEntries({ name: "n" })).toEqual([]);
    expect(parseScheduleEntries(undefined)).toEqual([]);
  });
});

describe("list", () => {
  test("lists one project's entries and no other's (AC-2)", () => {
    writeFileSync(file, JSON.stringify({
      schedules: {
        aide: [{ name: "a", cron: "0 3 * * *", prompt: "a.md" }],
        paceup: [{ name: "p", cron: "0 3 * * *", prompt: "p.md" }],
      },
    }));
    const store = createScheduleStore(file);
    expect(store.list("aide").map((e) => e.name)).toEqual(["a"]);
    expect(store.list("paceup").map((e) => e.name)).toEqual(["p"]);
    expect(store.list("other")).toEqual([]);
  });

  test("no file path, a missing file or no key is an empty list without a log line (AC-3)", () => {
    expect(createScheduleStore(undefined).list("aide")).toEqual([]);
    expect(createScheduleStore(file).list("aide")).toEqual([]);
    writeFileSync(file, "{}");
    expect(createScheduleStore(file).list("aide")).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  test("a trailing comma and comments are accepted", () => {
    writeFileSync(file, `{ // hand-written\n "schedules": { "aide": [ { "name": "a", "cron": "0 3 * * *", "prompt": "a.md", }, ], },\n}`);
    expect(createScheduleStore(file).list("aide")).toHaveLength(1);
  });

  test("a malformed value under schedules is an empty list", () => {
    writeFileSync(file, JSON.stringify({ schedules: { aide: "nightly", paceup: { name: "x" } } }));
    const store = createScheduleStore(file);
    expect(store.list("aide")).toEqual([]);
    expect(store.list("paceup")).toEqual([]);
  });

  test("a file that cannot be parsed is no jobs, and one line names the file, once (AC-2)", () => {
    writeFileSync(file, "{ not json");
    const store = createScheduleStore(file);
    expect(store.list("aide")).toEqual([]);
    expect(store.list("aide")).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]![0])).toContain(file);
  });

  test("a hand edit takes effect on the next call", () => {
    const store = createScheduleStore(file);
    expect(store.list("aide")).toEqual([]);
    writeFileSync(file, JSON.stringify({ schedules: { aide: [{ name: "a", cron: "0 3 * * *", prompt: "a.md" }] } }));
    expect(store.list("aide")).toHaveLength(1);
  });
});

describe("save", () => {
  test("creates the file and its directory, and the entry reads back (AC-1)", () => {
    const nested = join(dir, "deep", "queue-config.json");
    const store = createScheduleStore(nested);
    expect(store.save("aide", [entry({ since: "2026-09-17T20:54:52.809Z", model: "Sonnet" })])).toBeNull();
    expect(JSON.parse(readFileSync(nested, "utf-8")).schedules.aide[0]).toEqual({
      name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", model: "Sonnet", since: "2026-09-17T20:54:52.809Z",
    });
    expect(store.list("aide")).toEqual([entry({ since: "2026-09-17T20:54:52.809Z", model: "Sonnet" })]);
  });

  test("enabled is written only when false", () => {
    const store = createScheduleStore(file);
    store.save("aide", [entry({ enabled: false }), entry({ name: "other" })]);
    const written = JSON.parse(readFileSync(file, "utf-8")).schedules.aide;
    expect(written[0].enabled).toBe(false);
    expect("enabled" in written[1]).toBe(false);
  });

  test("an empty or whitespace-only file starts from {} (AC-1)", () => {
    writeFileSync(file, "  \n");
    expect(createScheduleStore(file).save("aide", [entry()])).toBeNull();
    expect(JSON.parse(readFileSync(file, "utf-8")).schedules.aide).toHaveLength(1);
  });

  test("comments and other keys survive a save (AC-1)", () => {
    const original = `{\n  // who may be queued\n  "projects": ["aide"],\n  "timeoutSec": { "implement": 100 }\n}\n`;
    writeFileSync(file, original);
    expect(createScheduleStore(file).save("aide", [entry()])).toBeNull();
    const after = readFileSync(file, "utf-8");
    expect(after).toContain("// who may be queued");
    expect(JSON.parse(after.replace(/\/\/.*$/m, "")).projects).toEqual(["aide"]);
    expect(after).toContain(`"implement": 100`);
  });

  test("another project's entries are untouched, and an empty list removes the project's key", () => {
    const store = createScheduleStore(file);
    store.save("aide", [entry()]);
    store.save("paceup", [entry({ name: "p" })]);
    store.save("aide", []);
    const schedules = JSON.parse(readFileSync(file, "utf-8")).schedules;
    expect("aide" in schedules).toBe(false);
    expect(schedules.paceup).toHaveLength(1);
  });

  test("refuses, naming the cause and leaving the file as it was: invalid JSONC, a non-object root, a non-object schedules (AC-1)", () => {
    for (const [content, cause] of [
      ["{ not json", "valid"],
      ["[1, 2]", "object"],
      [JSON.stringify({ schedules: ["x"] }), "schedules"],
    ] as const) {
      writeFileSync(file, content);
      const message = createScheduleStore(file).save("aide", [entry()]);
      expect(message).toContain(cause);
      expect(readFileSync(file, "utf-8")).toBe(content);
    }
  });

  test("refuses with no file path", () => {
    expect(createScheduleStore(undefined).save("aide", [entry()])).toContain("--queue-config");
  });

  test("leaves no temporary file behind", () => {
    createScheduleStore(file).save("aide", [entry()]);
    expect(existsSync(`${file}.tmp`)).toBe(false);
    mkdirSync(join(dir, "x"));
  });
});

describe("an entry's notification choice", () => {
  const base = { name: "n", cron: "0 3 * * *", prompt: "p.md" };

  test("each of the three values is read back (AC-7)", () => {
    for (const notify of ["never", "failure", "always"] as const) {
      expect(parseScheduleEntries([{ ...base, notify }])[0]!.notify).toBe(notify);
    }
  });

  test("an entry with no choice, or an unusable one, is kept and read as failure (AC-7)", () => {
    for (const notify of [undefined, "", "sometimes", 3, null]) {
      const [kept] = parseScheduleEntries([{ ...base, notify }]);
      expect(kept).toBeDefined();
      expect(kept!.notify).toBeUndefined();
      expect(scheduleNotifyOf(kept!)).toBe("failure");
    }
  });

  test("a saved choice is written to the file and only when present (AC-7)", () => {
    const store = createScheduleStore(file);
    expect(store.save("aide", [entry({ notify: "always" }), entry({ name: "plain" })])).toBeNull();
    const written = JSON.parse(readFileSync(file, "utf-8")).schedules.aide;
    expect(written[0].notify).toBe("always");
    expect("notify" in written[1]).toBe(false);
    expect(store.list("aide")[0]!.notify).toBe("always");
  });
});
