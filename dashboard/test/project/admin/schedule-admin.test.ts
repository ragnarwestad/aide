// The project-admin CRUD for schedule entries (spec 276, and spec 400's
// git-backed save): validation, create, update (including a rename),
// delete, and the enabled toggle. Modeled on update-settings.ts's
// changed-only-write, refuse-before-write shape. Acceptance criteria 5,
// 6, 7, 8, 17 (spec 276/277) and 1-3, 7 (spec 400) — unit level (Phase 4
// proves the same rules over HTTP).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createScheduleEntry,
  deleteScheduleEntry,
  scheduleEntryError,
  setScheduleEnabled,
  updateScheduleEntry,
} from "../../../src/project/project-admin.ts";
import type { ScheduleGit } from "../../../src/project/project-admin/schedule-admin.ts";
import { parseManifest } from "../../../src/project/parse-manifest.ts";
import { fakeGit, type Answer } from "../../helpers/fake-git.ts";

const dirs: string[] = [];
function projectDir(manifestText?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-schedule-admin-"));
  dirs.push(dir);
  writeFileSync(join(dir, "docs-nightly.md"), "# nightly\n");
  mkdirSync(join(dir, ".aide"), { recursive: true });
  writeFileSync(join(dir, ".aide", "project.yaml"), manifestText ?? "name: alpha\n");
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const manifestOf = (dir: string) => join(dir, ".aide", "project.yaml");
const schedule = (dir: string) => {
  const result = parseManifest(readFileSync(manifestOf(dir), "utf-8"));
  if (!result.ok) throw new Error(result.error);
  return result.data.schedule ?? [];
};

const HEAD_SHA = "1111111bbbbbbb";
const FILE_SHA = "a3f9c21aaaaaaa";

/** A code checkout that is clean, on its default branch, reachable, and
 *  whose manifest last moved at FILE_SHA — everything a schedule save
 *  asks for succeeds unless a test overrides it. Mirrors
 *  `spec-save-fixtures.ts`'s `savable()` for the same reason
 *  `specs-pull-save.test.ts`'s own copy does: this is `.aide/project.yaml`
 *  in the CODE checkout, not a spec file in the specs one, and pulls in
 *  `fakeGit`'s per-call recording (`git.calls`) rather than the plain
 *  function `spec-save-fixtures.ts` returns. */
function savable(root: string, extra: Record<string, Answer | Answer[]> = {}) {
  return fakeGit({
    "rev-parse --show-toplevel": { code: 0, stdout: `${root}\n` },
    "diff --cached --quiet HEAD": { code: 1 },
    "diff --quiet HEAD": { code: 0 },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "rev-parse HEAD": { code: 0, stdout: `${HEAD_SHA}\n` },
    fetch: { code: 0 },
    "merge-base --is-ancestor": { code: 0 },
    "merge -q --ff-only": { code: 0 },
    "log -1 --format=": { code: 0, stdout: `${FILE_SHA}\t2026-08-21T09:14:00+02:00\n` },
    add: { code: 0 },
    commit: { code: 0 },
    push: { code: 0 },
    "reset --hard": { code: 0 },
    ...extra,
  });
}

/** The `ScheduleGit` seam every write function now takes, over a
 *  `savable()` fake — `resolveBase` answers directly, the way
 *  `specs-pull-save.test.ts`'s own `base` does, rather than asking a
 *  fake git command for it. */
function scheduleGit(dir: string, extra?: Record<string, Answer | Answer[]>): { git: ScheduleGit; calls: ReturnType<typeof fakeGit>["calls"] } {
  const { run, calls } = savable(dir, extra);
  return { git: { run, resolveBase: async () => "main" }, calls };
}

describe("scheduleEntryError (acceptance criteria 5, 6, 7)", () => {
  test("a duplicate name is refused (criterion 5)", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const error = scheduleEntryError(dir, { name: "nightly", cron: "0 4 * * *", prompt: "docs-nightly.md" }, schedule(dir));
    expect(error).toContain("nightly");
  });

  test("a missing prompt path is refused, naming the missing path (criterion 6)", () => {
    const dir = projectDir();
    const error = scheduleEntryError(dir, { name: "nightly", cron: "0 3 * * *", prompt: "does-not-exist.md" }, []);
    expect(error).toContain("does-not-exist.md");
  });

  test("a prompt path escaping the project root is refused", () => {
    const dir = projectDir();
    const error = scheduleEntryError(dir, { name: "nightly", cron: "0 3 * * *", prompt: "../outside.md" }, []);
    expect(error).toBeTruthy();
  });

  test("an unparseable cron is refused (criterion 7)", () => {
    const dir = projectDir();
    const error = scheduleEntryError(dir, { name: "nightly", cron: "not-a-cron", prompt: "docs-nightly.md" }, []);
    expect(error).toBeTruthy();
  });

  test("a valid request has no error", () => {
    const dir = projectDir();
    const error = scheduleEntryError(dir, { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" }, []);
    expect(error).toBeNull();
  });

  test("editing an entry under its own unchanged name is not a collision", () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const error = scheduleEntryError(
      dir, { name: "nightly", cron: "0 4 * * *", prompt: "docs-nightly.md" }, schedule(dir), "nightly",
    );
    expect(error).toBeNull();
  });
});

describe("createScheduleEntry", () => {
  test("a duplicate name is refused before any file is written (criterion 5)", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const before = readFileSync(manifestOf(dir), "utf-8");
    const { git, calls } = scheduleGit(dir);
    const result = await createScheduleEntry(git, dir, { name: "nightly", cron: "0 4 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(false);
    expect(readFileSync(manifestOf(dir), "utf-8")).toBe(before);
    expect(calls).toHaveLength(0);
  });

  test("a valid entry is appended, enabled by default, and committed and pushed (criteria 1, 2)", async () => {
    const dir = projectDir();
    const { git, calls } = scheduleGit(dir);
    const result = await createScheduleEntry(git, dir, { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(true);
    expect(schedule(dir)).toEqual([
      { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", enabled: true },
    ]);
    const names = calls.map((c) => c.args[0]);
    expect(names).toContain("add");
    expect(names).toContain("commit");
    const push = calls.find((c) => c.args[0] === "push");
    // REQ-1: pushed to `origin`, from HEAD — not merely a local commit.
    expect(push?.args).toEqual(["push", "-q", "origin", "HEAD"]);
    // Nothing left staged or uncommitted after a successful save.
    expect(calls.some((c) => c.args[0] === "reset")).toBe(false);
  });

  test("the picked model is stored on the entry", async () => {
    const dir = projectDir();
    const { git } = scheduleGit(dir);
    const result = await createScheduleEntry(
      git,
      dir,
      { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", model: "claude-opus-5" },
      ["claude-opus-5", "codex-fast"],
    );
    expect(result.ok).toBe(true);
    expect(schedule(dir)[0]!.model).toBe("claude-opus-5");
  });

  test("a model the dashboard does not offer is refused before any file is written", async () => {
    const dir = projectDir();
    const before = readFileSync(manifestOf(dir), "utf-8");
    const { git } = scheduleGit(dir);
    const result = await createScheduleEntry(
      git,
      dir,
      { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", model: "retired-model" },
      ["claude-opus-5"],
    );
    expect(result.ok).toBe(false);
    expect(readFileSync(manifestOf(dir), "utf-8")).toBe(before);
  });

  test("no model at all is accepted — the configuration decides", async () => {
    const dir = projectDir();
    const { git } = scheduleGit(dir);
    const result = await createScheduleEntry(git, dir, { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", model: "" }, [
      "claude-opus-5",
    ]);
    expect(result.ok).toBe(true);
    expect(schedule(dir)[0]!.model).toBeUndefined();
  });

  test("a base sha that moved since it was read is refused (criterion 3)", async () => {
    const dir = projectDir();
    // The FIRST `log -1 --format=` answers what `saveEntries` reads as
    // `baseSha`; the SECOND — `saveSpecFile`'s own re-check — answers a
    // DIFFERENT sha, as another edit landing between the two reads would.
    const { git, calls } = scheduleGit(dir, {
      "log -1 --format=": [
        { code: 0, stdout: `${FILE_SHA}\t2026-08-21T09:14:00+02:00\n` },
        { code: 0, stdout: "deadbee1234567\t2026-08-21T09:20:00+02:00\n" },
      ],
    });
    const result = await createScheduleEntry(git, dir, { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(false);
    // The exact wording `specs-pull.ts:260-264` already gives a spec-file
    // save — proving this goes through that SAME guard, not a hand-rolled one.
    expect((result as { error: string }).error).toContain("changed since you opened it");
    expect(schedule(dir)).toEqual([]);
    expect(calls.some((c) => c.args[0] === "commit")).toBe(false);
  });

  test("a commit that fails is rolled back and nothing is pushed (criterion 7)", async () => {
    const dir = projectDir();
    const { git, calls } = scheduleGit(dir, { commit: { code: 1 } });
    const result = await createScheduleEntry(git, dir, { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(false);
    const reset = calls.find((c) => c.args[0] === "reset");
    expect(reset).toBeDefined();
    expect(reset!.args).toContain("--hard");
    expect(calls.some((c) => c.args[0] === "push")).toBe(false);
  });

  test("a push that fails is rolled back, and the failure is reported by name (criterion 7)", async () => {
    const dir = projectDir();
    const { git, calls } = scheduleGit(dir, { push: { code: 1 } });
    const result = await createScheduleEntry(git, dir, { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBeTruthy();
    const reset = calls.find((c) => c.args[0] === "reset");
    expect(reset).toBeDefined();
    expect(reset!.args).toContain("--hard");
  });
});

describe("updateScheduleEntry (including a rename, acceptance criterion 17)", () => {
  test("editing the model replaces the entry's own pick and keeps everything else", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n" +
        "    model: claude-opus-5\n",
    );
    const { git } = scheduleGit(dir);
    const result = await updateScheduleEntry(
      git,
      dir,
      "nightly",
      { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", model: "codex-fast" },
      ["claude-opus-5", "codex-fast"],
    );
    expect(result.ok).toBe(true);
    expect(schedule(dir)).toEqual([
      { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", enabled: true, model: "codex-fast" },
    ]);
  });

  test("a valid edit commits and pushes (criteria 1, 2)", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const { git, calls } = scheduleGit(dir);
    const result = await updateScheduleEntry(git, dir, "nightly", { name: "nightly", cron: "0 5 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(true);
    const push = calls.find((c) => c.args[0] === "push");
    expect(push?.args).toEqual(["push", "-q", "origin", "HEAD"]);
  });

  test("a model the dashboard does not offer is refused", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const { git } = scheduleGit(dir);
    const result = await updateScheduleEntry(
      git,
      dir,
      "nightly",
      { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", model: "retired-model" },
      ["claude-opus-5"],
    );
    expect(result.ok).toBe(false);
  });

  test("editing cron leaves the name and every other entry untouched", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n" +
        "  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs-nightly.md\n",
    );
    const { git } = scheduleGit(dir);
    const result = await updateScheduleEntry(git, dir, "nightly", { name: "nightly", cron: "0 5 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(true);
    expect(schedule(dir)).toEqual([
      { name: "nightly", cron: "0 5 * * *", prompt: "docs-nightly.md", enabled: true },
      { name: "weekly", cron: "0 4 * * 0", prompt: "docs-nightly.md", enabled: true },
    ]);
  });

  test("renaming an entry is accepted and the entry keeps its position (criterion 17)", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const { git } = scheduleGit(dir);
    const result = await updateScheduleEntry(git, dir, "nightly", { name: "nightly-2", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(true);
    expect(schedule(dir)).toEqual([
      { name: "nightly-2", cron: "0 3 * * *", prompt: "docs-nightly.md", enabled: true },
    ]);
  });

  test("renaming to a name already used by ANOTHER entry is refused", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n" +
        "  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs-nightly.md\n",
    );
    const { git } = scheduleGit(dir);
    const result = await updateScheduleEntry(git, dir, "nightly", { name: "weekly", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(false);
  });

  test("editing a nonexistent entry is refused", async () => {
    const dir = projectDir();
    const { git } = scheduleGit(dir);
    const result = await updateScheduleEntry(git, dir, "ghost", { name: "ghost", cron: "0 3 * * *", prompt: "docs-nightly.md" });
    expect(result.ok).toBe(false);
  });
});

describe("setScheduleEnabled (acceptance criterion 8 — no confirm field required)", () => {
  test("flips enabled to false with only the enabled field, and commits and pushes (criteria 1, 2)", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const { git, calls } = scheduleGit(dir);
    const result = await setScheduleEnabled(git, dir, "nightly", false);
    expect(result.ok).toBe(true);
    expect(schedule(dir)[0]!.enabled).toBe(false);
    expect(calls.map((c) => c.args[0])).toContain("commit");
  });

  test("flips enabled back to true", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n    enabled: false\n",
    );
    const { git } = scheduleGit(dir);
    const result = await setScheduleEnabled(git, dir, "nightly", true);
    expect(result.ok).toBe(true);
    expect(schedule(dir)[0]!.enabled).toBe(true);
  });

  test("setting the same value is a no-op write (changed-only) — no git command runs", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const before = readFileSync(manifestOf(dir), "utf-8");
    const { git, calls } = scheduleGit(dir);
    const result = await setScheduleEnabled(git, dir, "nightly", true);
    expect(result.ok).toBe(true);
    expect(readFileSync(manifestOf(dir), "utf-8")).toBe(before);
    expect(calls).toHaveLength(0);
  });

  test("toggling a nonexistent entry is refused", async () => {
    const dir = projectDir();
    const { git } = scheduleGit(dir);
    const result = await setScheduleEnabled(git, dir, "ghost", false);
    expect(result.ok).toBe(false);
  });
});

describe("deleteScheduleEntry (spec 277, acceptance criteria 1, 3, 5)", () => {
  test("deletes the named entry, leaves the others, and commits and pushes (criteria 1, 2)", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n" +
        "  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs-nightly.md\n",
    );
    const { git, calls } = scheduleGit(dir);
    const result = await deleteScheduleEntry(git, dir, "nightly");
    expect(result.ok).toBe(true);
    expect(schedule(dir)).toEqual([
      { name: "weekly", cron: "0 4 * * 0", prompt: "docs-nightly.md", enabled: true },
    ]);
    const push = calls.find((c) => c.args[0] === "push");
    expect(push?.args).toEqual(["push", "-q", "origin", "HEAD"]);
  });

  test("deleting the only entry removes the schedule key entirely (criterion 3)", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const { git } = scheduleGit(dir);
    const result = await deleteScheduleEntry(git, dir, "nightly");
    expect(result.ok).toBe(true);
    expect(readFileSync(manifestOf(dir), "utf-8")).not.toContain("schedule:");
  });

  test("deleting an unknown name is refused and writes nothing (criterion 5)", async () => {
    const dir = projectDir(
      "name: alpha\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    const before = readFileSync(manifestOf(dir), "utf-8");
    const { git, calls } = scheduleGit(dir);
    const result = await deleteScheduleEntry(git, dir, "ghost");
    expect(result.ok).toBe(false);
    expect(readFileSync(manifestOf(dir), "utf-8")).toBe(before);
    expect(calls).toHaveLength(0);
  });
});
