// Spec 185: the lockfile → command table, in code for the first time.
//
// It has existed as prose in `core/skills/tools-and-scripts/SKILL.md`
// since long before this, followed by an AI agent reading it while
// implementing — never by anything a page could ask. A project's page
// has to say what a run would use for `AIDE_TEST_CMD` when the config
// file does not say, and that answer is this table.
//
// The questions here are the table's own: which file decides, in which
// order when a project ships two, which of test/lint/build a toolchain
// actually has, and that a project the table does not recognise gets
// nothing rather than a guess.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectCommands } from "../src/detect-commands.ts";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A project root holding exactly the files named, and nothing else. */
function rootWith(...files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-detect-"));
  dirs.push(dir);
  for (const f of files) writeFileSync(join(dir, f), "");
  return dir;
}

describe("detectProjectCommands reads the table in the skill doc", () => {
  // One row of the table per case: the file that decides, and what the
  // toolchain's three commands are (or are not — Gradle and Maven have
  // no lint in the table, and pytest has only a test command).
  const TABLE: {
    file: string;
    toolchain: string;
    test?: string;
    lint?: string;
    build?: string;
  }[] = [
    { file: "pnpm-lock.yaml", toolchain: "pnpm", test: "pnpm test -- --run", lint: "pnpm run lint", build: "pnpm run build" },
    { file: "package-lock.json", toolchain: "npm", test: "npm test", lint: "npm run lint", build: "npm run build" },
    { file: "yarn.lock", toolchain: "yarn", test: "yarn test", lint: "yarn lint", build: "yarn build" },
    { file: "gradlew", toolchain: "Gradle", test: "./gradlew test", build: "./gradlew build" },
    { file: "pom.xml", toolchain: "Maven", test: "mvn test", build: "mvn verify" },
    { file: "pytest.ini", toolchain: "pytest", test: "python -m pytest" },
    { file: "pyproject.toml", toolchain: "pytest", test: "python -m pytest" },
    { file: "go.mod", toolchain: "Go", test: "go test ./...", build: "go build ./..." },
    { file: "Cargo.toml", toolchain: "Cargo", test: "cargo test", build: "cargo build" },
  ];

  for (const row of TABLE) {
    test(`${row.file} yields the ${row.toolchain} commands, sourced to the file that decided`, () => {
      const found = detectProjectCommands(rootWith(row.file));
      for (const kind of ["test", "lint", "build"] as const) {
        const want = row[kind];
        expect([kind, found[kind]?.cmd]).toEqual([kind, want]);
        // A command with no entry in the table is absent, not a blank
        // string — "not set" and "set to nothing" read differently on
        // the page.
        if (want) {
          expect(found[kind]!.source).toBe(row.file);
          expect(found[kind]!.toolchain).toBe(row.toolchain);
        }
      }
    });
  }

  test("a project with no file the table knows yields nothing at all", () => {
    const found = detectProjectCommands(rootWith("README.md", "Makefile"));
    expect(found.test).toBeUndefined();
    expect(found.lint).toBeUndefined();
    expect(found.build).toBeUndefined();
  });

  test("an empty project yields nothing rather than throwing", () => {
    expect(detectProjectCommands(rootWith())).toEqual({});
  });

  test("a root that does not exist yields nothing rather than throwing", () => {
    expect(detectProjectCommands(join(tmpdir(), "aide-detect-no-such-dir"))).toEqual({});
  });

  // First match wins, in the table's own order — a repo that ships both
  // a pnpm lockfile and a package-lock is a real thing, and the page
  // must name one command, not two.
  test("the table's order decides when a project ships two of them", () => {
    const found = detectProjectCommands(rootWith("package-lock.json", "pnpm-lock.yaml"));
    expect(found.test?.source).toBe("pnpm-lock.yaml");
  });

  test("pytest.ini wins over pyproject.toml, as the table lists it first", () => {
    const found = detectProjectCommands(rootWith("pyproject.toml", "pytest.ini"));
    expect(found.test?.source).toBe("pytest.ini");
  });

  // ROOT only, the same rule `.claude/CLAUDE.md` states for aide's own
  // detection: a lockfile in a subdirectory belongs to that
  // subdirectory's toolchain, not to the project's.
  test("a lockfile one directory down decides nothing", () => {
    const dir = rootWith();
    const sub = join(dir, "dashboard");
    require("node:fs").mkdirSync(sub);
    writeFileSync(join(sub, "pnpm-lock.yaml"), "");
    expect(detectProjectCommands(dir)).toEqual({});
  });
});
