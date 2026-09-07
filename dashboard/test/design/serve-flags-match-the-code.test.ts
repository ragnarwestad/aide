// A dropped option killed the board. `--claude-usage` was removed from
// the code; the launchd job that serves the dashboard went on passing
// it, because a merge installs code and never touches the job's
// arguments. The board ran on happily until the next restart, and then
// refused to start at all.
//
// Two halves guard it: the Makefile's own argument list, checked here
// against what the parser accepts, and the INSTALLED job's arguments,
// checked by deploy/install-after-merge.sh on the serving host — the
// only place the real service's arguments can be seen.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MAKEFILE = read("../../Makefile");
const PARSE_ARGS = read("../../src/serve/serve-helpers/parse-args.ts");
const INSTALL = read("../../deploy/install-after-merge.sh");
const SHELL = read("../../src/render/ui/shell.ts");

describe("the serve job passes only options the code accepts", () => {
  test("every flag install-serve hands to serve is one parse-args accepts", () => {
    // The one backslash-continued command, from `-- serve` to the first
    // line that does not continue: anything after it is a different
    // command with flags of its own.
    const target = /^install-serve: require-host$([\s\S]*?)^\S/m.exec(MAKEFILE)?.[1] ?? "";
    const lines = target.slice(target.indexOf("-- serve")).split("\n");
    const end = lines.findIndex((l) => !l.trimEnd().endsWith("\\"));
    const argv = lines.slice(0, end + 1).join("\n");
    const flags = [...new Set([...argv.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]))];
    expect(flags.length).toBeGreaterThan(5);
    const unknown = flags.filter((f) => !PARSE_ARGS.includes(`"${f}"`));
    expect(unknown).toEqual([]);
  });

  // The installed job is machine state, so no test can read it. The
  // install step runs where it can, and says so in the log the board
  // draws its banner from.
  test("the install step checks the installed job and warns in the log", () => {
    expect(INSTALL).toContain("LaunchAgents/com.aide-dashboard.serve.plist");
    expect(INSTALL).toContain("parse-args.ts");
    expect(INSTALL).toContain("⚠️ [aide serve]");
  });

  test("the board's banner shows that warning, not only the tools one", () => {
    expect(SHELL).toContain("[aide (tools|serve)");
  });
});
