// What a run would use for a project's test, lint and build command
// when `.aide/config` does not say (spec 185).
//
// The table itself is old — `core/skills/tools-and-scripts/SKILL.md`
// has carried it since long before this file, and every AI agent
// implementing in a project has been following it by reading it. This
// is the first time anything CODE can ask has been able to answer the
// same question, which is what a project's page needs: a test command
// is usually worked out rather than configured, so the config file
// alone does not say what a run will do.
//
// Two rules taken from the doc verbatim, and both matter:
//
//  - First match wins, in the table's own order. A repo shipping both
//    a pnpm lockfile and a package-lock is a real thing, and the page
//    has to name one command rather than two.
//  - The ROOT only. A lockfile one directory down belongs to that
//    directory's toolchain — the same rule `.claude/CLAUDE.md` states
//    for aide itself, whose root is pytest while `dashboard/` is bun.
//
// And one thing this file deliberately does NOT do: promise. The doc
// says the commands are "the usual defaults, not a promise" — for a
// JS/TS project the exact script names live in `package.json`, which
// nothing here reads. The page hedges the row accordingly; nothing
// here is ever executed.

import { existsSync } from "node:fs";
import { join } from "node:path";

export type CommandKind = "test" | "lint" | "build";

export interface DetectedCommand {
  /** The command itself, as the table writes it. */
  cmd: string;
  /** The file in the project root that decided it — what the page
   *  shows when it says where a value came from. */
  source: string;
  /** What the file says the project is built with. */
  toolchain: string;
}

export type DetectedCommands = Partial<Record<CommandKind, DetectedCommand>>;

/** The table from `core/skills/tools-and-scripts/SKILL.md`, in its own
 *  order. A toolchain with no entry for a command has none in the doc
 *  either — Gradle and Maven are given no lint command there, and
 *  pytest neither lint nor build — and inventing one here would put a
 *  command on the page that nobody wrote down. */
const TABLE: { file: string; toolchain: string; test?: string; lint?: string; build?: string }[] = [
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

/** Which of test/lint/build the project's own root points at, if any.
 *  A project the table does not recognise gets an empty answer — "not
 *  set" is the honest thing to show, and a guess would be worse than
 *  silence on a page whose whole point is saying where a value came
 *  from. */
export function detectProjectCommands(root: string): DetectedCommands {
  for (const row of TABLE) {
    if (!existsSync(join(root, row.file))) continue;
    const found: DetectedCommands = {};
    for (const kind of ["test", "lint", "build"] as const) {
      const cmd = row[kind];
      if (cmd) found[kind] = { cmd, source: row.file, toolchain: row.toolchain };
    }
    return found;
  }
  return {};
}
