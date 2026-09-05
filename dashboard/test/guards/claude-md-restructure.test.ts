import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const claudeMd = () => readFileSync(join(ROOT, "dashboard", "CLAUDE.md"), "utf-8");
const developmentMd = () => readFileSync(join(ROOT, ".claude", "rules", "development.md"), "utf-8");
const pairsPage = () => readFileSync(join(ROOT, "dashboard", "docs", "bash-typescript-decisions.md"), "utf-8");

describe("dashboard/CLAUDE.md keeps its rules (REQ-1)", () => {
  test("still tells a session how a run touches the repositories, lands and archives", () => {
    const text = claudeMd();
    expect(text).toContain("`aide-run-spec` branches EVERY repo it touches");
    expect(text).toContain("No step's work is merged by hand.");
    expect(text).toContain("Origin decides whether an `archive` landing finished.");
    expect(text.replace(/\s+/g, " ")).toContain(
      "A conflict is `archive`'s to resolve, by the literal string `archive`, never a denylist.",
    );
  });
});

describe("dashboard/CLAUDE.md points at the pairs detail instead of carrying it (REQ-3)", () => {
  test("keeps the rule that pairs exist, are pinned, and shared-source decisions are not pairs", () => {
    const text = claudeMd().replace(/\s+/g, " ");
    expect(text).toContain("pinned by a test that reads both sides");
    expect(text).toContain("never hand-paired");
  });
  test("points at the new page", () => {
    expect(claudeMd()).toContain("docs/bash-typescript-decisions.md");
  });
  test("no longer carries the table itself", () => {
    expect(claudeMd()).not.toContain("Pinned by");
  });
});

describe("the installation section moved out of dashboard/CLAUDE.md into development.md (REQ-4)", () => {
  test("dashboard/CLAUDE.md no longer carries it", () => {
    expect(claudeMd()).not.toContain("install_common_bin");
  });
  test(".claude/rules/development.md carries it instead", () => {
    const text = developmentMd();
    expect(text).toContain("Individual uninstallers never remove the shared scripts");
    expect(text).toContain("install_common_bin");
    expect(text).toContain("install_shell_path");
  });
});

describe("the new page carries the pairs detail (REQ-2)", () => {
  test("has every pinning fixture/test name from the table", () => {
    const text = pairsPage();
    for (const name of [
      "project-readiness-prerequisites.json",
      "worktree-links-precedence.json",
      "parsing-schedule-and-errors.test.ts",
      "code-landing-precedence.json",
      "config-cmd-precedence.json",
      "status-row-counting.json",
      "error-sentence-registry.test.ts",
      "run_spec_project_state.py",
      "branch-merge-push-retry.test.ts",
    ]) {
      expect(text).toContain(name);
    }
  });
  test("names all three shared-source decisions", () => {
    const text = pairsPage();
    expect(text).toContain("workflow-steps.json");
    expect(text).toContain("effort-levels.json");
    expect(text).toContain("transitions.json");
  });
});
