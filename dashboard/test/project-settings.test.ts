// Spec 185: the seven `.aide/config` keys, each answered with where its
// value came from.
//
// The description's bar is that a reader can tell, for every setting,
// whether it was CONFIGURED or WORKED OUT — and that a setting which is
// neither is shown as not set rather than left out, because what is
// missing is exactly what stops a run.
//
// The one rule this file guards hardest: resolution is not recomputed
// here. `assessProjectReadiness` already decides whether a specs root
// or a worktree link is there, and `.claude/rules/development.md` names
// a second, hand-synchronised copy of that decision as a mistake this
// repo has already paid for twice. So the row's problem text is read
// VERBATIM off the injected readiness result.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectReadiness, ReadinessCheck } from "../src/project/project-admin.ts";
import { DERIVABLE, SETTING_KEYS, projectSettings } from "../src/project/project-settings.ts";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A project root with the `.aide/config` named — or none at all, which
 *  is the state a project cloned onto a second machine is in. */
function project(config: string | null, ...files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-settings-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".aide"), { recursive: true });
  writeFileSync(join(dir, ".aide", "project.yaml"), "name: p\n");
  if (config !== null) writeFileSync(join(dir, ".aide", "config"), config);
  for (const f of files) writeFileSync(join(dir, f), "");
  return dir;
}

/** A readiness result saying exactly what the checks passed in say, and
 *  nothing more — the injection point that keeps this module from
 *  having an opinion about whether a path resolves. */
const readiness = (...checks: ReadinessCheck[]): ProjectReadiness => ({
  canRun: checks.every((c) => !c.blocking),
  checks,
  note: "",
});

const row = (dir: string, key: string, r: ProjectReadiness | null = null) =>
  projectSettings(dir, r).rows.find((x) => x.key === key)!;

describe("every recognized key gets a row, in one order", () => {
  test("the seven keys are all there, once each", () => {
    const view = projectSettings(project(null), null);
    expect(view.rows.map((r) => r.key)).toEqual([...SETTING_KEYS]);
    expect(new Set(view.rows.map((r) => r.key)).size).toBe(view.rows.length);
  });

  test("a project with no .aide/config at all says so, and still renders every row", () => {
    const view = projectSettings(project(null), null);
    expect(view.hasConfigFile).toBe(false);
    expect(view.rows.length).toBe(SETTING_KEYS.length);
  });

  test("a project WITH the file says so", () => {
    expect(projectSettings(project("AIDE_TEST_CMD=make test\n"), null).hasConfigFile).toBe(true);
  });
});

describe("configured, worked out, or not set", () => {
  test("a configured command wins over the lockfile beside it", () => {
    const r = row(project("AIDE_TEST_CMD=make test\n", "pnpm-lock.yaml"), "AIDE_TEST_CMD");
    expect(r.origin).toBe("configured");
    expect(r.value).toBe("make test");
    // Nothing was worked out, so nothing names a source.
    expect(r.source).toBeUndefined();
  });

  test("an unconfigured command is worked out from the lockfile, and says which", () => {
    const r = row(project("", "pnpm-lock.yaml"), "AIDE_TEST_CMD");
    expect(r.origin).toBe("derived");
    expect(r.value).toBe("pnpm test -- --run");
    expect(r.source).toBe("pnpm-lock.yaml");
    // Named because the page says it: a worked-out command is the
    // default for a TOOLCHAIN, not a command anyone ran here.
    expect(r.toolchain).toBe("pnpm");
  });

  test("a command key with neither a value nor a lockfile reads not set", () => {
    const r = row(project(""), "AIDE_BUILD_CMD");
    expect(r.origin).toBe("unset");
    expect(r.value).toBeNull();
  });

  // The toolchain has no lint command in the table at all, so there is
  // nothing to work out — the row must not claim a derived value.
  test("a toolchain the table gives no lint command leaves that key not set", () => {
    const r = row(project("", "go.mod"), "AIDE_LINT_CMD");
    expect(r.origin).toBe("unset");
    expect(row(project("", "go.mod"), "AIDE_TEST_CMD").origin).toBe("derived");
  });

  for (const key of ["AIDE_INSTALL_CMD", "AIDE_JIRA_BASE_URL", "AIDE_WORKTREE_LINKS", "AIDE_SPECS_PATH"]) {
    test(`${key} is never worked out from a lockfile`, () => {
      const r = row(project("", "pnpm-lock.yaml"), key);
      expect([key, r.origin]).toEqual([key, "unset"]);
      expect([key, r.value]).toEqual([key, null]);
    });
  }

  test("a configured non-command key is shown as configured", () => {
    const r = row(project("AIDE_JIRA_BASE_URL=https://jira.example.com\n"), "AIDE_JIRA_BASE_URL");
    expect(r.origin).toBe("configured");
    expect(r.value).toBe("https://jira.example.com");
  });
});

describe("a value that does not resolve is marked, in the words readiness already used", () => {
  const missingLinks: ReadinessCheck = {
    check: "worktreeLinks",
    subject: "/tmp/p",
    ok: false,
    blocking: true,
    detail: "a run refuses a worktree link with nothing to link: node_modules is not in /tmp/p",
  };
  const missingSpecs: ReadinessCheck = {
    check: "specsRoot",
    subject: "/tmp/elsewhere",
    ok: false,
    blocking: true,
    detail: "there is no specs root at /tmp/elsewhere, and a run refuses without one",
  };

  test("a worktree link with nothing to link carries readiness's own sentence (criterion 4)", () => {
    const dir = project("AIDE_WORKTREE_LINKS=node_modules\n");
    expect(row(dir, "AIDE_WORKTREE_LINKS", readiness(missingLinks)).problem).toBe(missingLinks.detail);
  });

  test("a specs root that is not there carries readiness's own sentence (criterion 5)", () => {
    const dir = project("AIDE_SPECS_PATH=/tmp/elsewhere\n");
    expect(row(dir, "AIDE_SPECS_PATH", readiness(missingSpecs)).problem).toBe(missingSpecs.detail);
  });

  test("a check that passed leaves the row with no problem", () => {
    const dir = project("AIDE_SPECS_PATH=/tmp/elsewhere\n");
    const ok: ReadinessCheck = {
      check: "specsRoot",
      subject: "/tmp/elsewhere",
      ok: true,
      blocking: false,
      detail: "the specs live at /tmp/elsewhere",
    };
    expect(row(dir, "AIDE_SPECS_PATH", readiness(ok)).problem).toBeUndefined();
  });

  // No readiness at all is what a git that cannot answer leaves behind.
  // The rows still say what the file says; nothing claims a path is
  // missing on no evidence.
  test("with no readiness result nothing is marked as unresolved", () => {
    const dir = project("AIDE_WORKTREE_LINKS=node_modules\nAIDE_SPECS_PATH=/tmp/elsewhere\n");
    for (const key of ["AIDE_WORKTREE_LINKS", "AIDE_SPECS_PATH"]) {
      expect([key, row(dir, key, null).problem]).toEqual([key, undefined]);
    }
  });

  // The unset case readiness reports anyway: "no worktree links are
  // configured" is a note about a key nobody set, not a value that
  // failed to resolve.
  test("an unset key is not marked as unresolved, whatever readiness says about it", () => {
    const unsetNote: ReadinessCheck = {
      check: "worktreeLinks",
      subject: "/tmp/p",
      ok: false,
      blocking: false,
      detail: "no worktree links are configured — a run's worktree carries tracked files only",
    };
    const r = row(project(""), "AIDE_WORKTREE_LINKS", readiness(unsetNote));
    expect(r.origin).toBe("unset");
    expect(r.problem).toBeUndefined();
  });
});

// Spec 255: the Worktree links row moved from raw `configValue()` to
// `resolveWorktreeLinks()`'s manifest-then-config precedence, and
// `DERIVABLE` is now exported so `render/site.ts` can gate edit-mode on
// key membership rather than a second, hand-duplicated list.
describe("the Worktree links row is sourced from resolveWorktreeLinks() (spec 255)", () => {
  test("DERIVABLE's export names exactly the three command keys, and touches no row shape", () => {
    expect(Object.keys(DERIVABLE).sort()).toEqual(["AIDE_BUILD_CMD", "AIDE_LINT_CMD", "AIDE_TEST_CMD"]);
    const view = projectSettings(project(null), null);
    expect(view.rows.map((r) => r.key)).toEqual([...SETTING_KEYS]);
  });

  test("the manifest's worktreeLinks: wins when both files set it, and the row names that file (criterion 2)", () => {
    const dir = project("AIDE_WORKTREE_LINKS=other-deps\n");
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: p\nworktreeLinks: deps\n");
    const r = row(dir, "AIDE_WORKTREE_LINKS");
    expect(r.origin).toBe("configured");
    expect(r.value).toBe("deps");
    expect(r.source).toBe("project.yaml");
  });

  test("a legacy value in .aide/config alone still resolves, and the row names that file", () => {
    const dir = project("AIDE_WORKTREE_LINKS=deps\n");
    const r = row(dir, "AIDE_WORKTREE_LINKS");
    expect(r.origin).toBe("configured");
    expect(r.value).toBe("deps");
    expect(r.source).toBe(".aide/config");
  });

  test("neither file setting it reads unset, same as before", () => {
    const dir = project("");
    const r = row(dir, "AIDE_WORKTREE_LINKS");
    expect(r.origin).toBe("unset");
    expect(r.value).toBeNull();
    expect(r.source).toBeUndefined();
  });
});
