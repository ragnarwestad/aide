// Every documentation page people read opens with its title and then its
// table of contents, before any other text: the documentation standard's order, and
// the first thing a reader or an AI assistant uses to find its way.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD = join(import.meta.dir, "..", "..");
const DIRS = [join(DASHBOARD, "docs"), join(DASHBOARD, "..", "docs")];

/** The pages people read outside docs/. Skills, rules, agents and
 *  CLAUDE.md are read by models, and keep no contents list of their own. */
const REPO = join(DASHBOARD, "..");
const READ_BY_PEOPLE = [
  "README.md", "DEVELOPING.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md",
  "core/tests/README.md", "specs/README.md", "dashboard/README.md",
  "core/implementations/claude-code/README.md", "core/implementations/claude-code/INSTALL.md",
  "core/implementations/codex/README.md", "core/implementations/codex/mcp/BROWSER_TESTING_MCP_SETUP.md",
  "core/implementations/codex/mcp/CONTEXT7_MCP_SETUP.md", "core/implementations/copilot/README.md",
  "core/implementations/copilot/INSTALL.md", "core/implementations/opencode/README.md",
];

const pages = [
  ...DIRS.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => join(dir, f))),
  ...READ_BY_PEOPLE.map((f) => join(REPO, f)),
];

test.each(pages.map((p) => [p.slice(DASHBOARD.length - "dashboard".length), p]))(
  "%s has its table of contents first, under its title",
  (_name, path) => {
    const lines = readFileSync(path, "utf-8").split("\n").filter((l) => l.trim() !== "");
    expect(lines[0]!.startsWith("# ")).toBe(true);
    expect(lines[1]).toBe("## Table of contents");
  },
);
