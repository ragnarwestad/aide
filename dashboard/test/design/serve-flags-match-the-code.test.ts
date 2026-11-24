// A dropped option killed the board. `--claude-usage` was removed from
// the code; the launchd job that serves the dashboard went on passing
// it, because a merge installs code and never touches the job's
// arguments. The board ran on happily until the next restart, and then
// refused to start at all.
//
// Two halves guard it: the Makefile's own argument list, checked here
// against deploy/serve-args.json — the one list of flags the parser and
// the repair both read — and the INSTALLED job's arguments, repaired by
// deploy/install-after-merge.sh on the serving host, the only place the
// real service's arguments can be seen.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../../src/serve/serve-helpers/parse-args.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MAKEFILE = read("../../Makefile");
const DEFINITION_PATH = fileURLToPath(new URL("../../deploy/serve-args.json", import.meta.url));
const DEFINED = Object.keys(JSON.parse(read("../../deploy/serve-args.json")) as Record<string, unknown>).sort();
const REPAIR = read("../../deploy/repair-serve-plist.sh");
const INSTALL = read("../../deploy/install-after-merge.sh");
const SHELL = read("../../src/render/ui/header-notices.ts");
const SERVE_SH = read("../../serve.sh");
const SERVICE = JSON.parse(read("../../deploy/service.json")) as { label: string };

const flagsIn = (text: string): string[] =>
  [...new Set([...text.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]))].sort();

/** The flags install-serve hands to `serve`: the one backslash-continued
 *  command, from `-- serve` to the first line that does not continue. */
function installServeFlags(): string[] {
  const target = /^install-serve: require-host$([\s\S]*?)^\S/m.exec(MAKEFILE)?.[1] ?? "";
  const lines = target.slice(target.indexOf("-- serve")).split("\n");
  const end = lines.findIndex((l) => !l.trimEnd().endsWith("\\"));
  return flagsIn(lines.slice(0, end + 1).join("\n"));
}

describe("the serve job passes only options the code accepts", () => {
  test("every flag install-serve hands to serve is one the definition names (AC-1)", () => {
    const flags = installServeFlags();
    expect(flags.length).toBeGreaterThan(5);
    const unknown = flags.filter((f) => !DEFINED.includes(f));
    expect(unknown).toEqual([]);
  });

  test("parseArgs accepts every flag the definition names, each with a value (AC-1)", () => {
    expect(DEFINED.length).toBeGreaterThan(5);
    for (const flag of DEFINED) expect(() => parseArgs([flag, "1"])).not.toThrow();
  });

  // The repair reads the definition with sed, one flag per line: a
  // reformatted file it reads fewer flags from would drop valid ones.
  test("the repair's reader finds exactly the definition's flags (AC-1)", () => {
    const expr = /sed -n -E '([^']+)' "\$definition"/.exec(REPAIR)?.[1];
    expect(expr).toBeDefined();
    const out = Bun.spawnSync(["sed", "-n", "-E", expr!, DEFINITION_PATH]).stdout.toString();
    const read = out.trim().split("\n").map((l) => l.split(" ")[0]).sort();
    expect(read).toEqual(DEFINED);
  });

  // serve.sh is the same service with no launchd, on Linux: what one
  // runs, the other must run too.
  test("serve.sh passes serve exactly the flags install-serve does", () => {
    const argv = SERVE_SH.slice(SERVE_SH.indexOf("src/serve/serve.ts serve"));
    expect(flagsIn(argv)).toEqual(installServeFlags());
  });

  // The installed job is machine state, so no test can read it. The
  // install step repairs it where it can (repair-serve-plist.test.ts),
  // and says so in the log the board draws its banner from when it cannot.
  test("the install step repairs the installed job, and warns in the log when it cannot", () => {
    expect(INSTALL).toContain("deploy/service.json");
    expect(INSTALL).toContain("dashboard/deploy/serve-args.json");
    expect(INSTALL).toContain("repair-serve-plist.sh");
    expect(INSTALL).toContain("⚠️ [aide serve]");
  });

  test("Make, TypeScript and install read one service identity (AC-7)", () => {
    expect(SERVICE.label).toBe("com.aide-dashboard.serve");
    expect(MAKEFILE).toContain("deploy/service.json");
    expect(INSTALL).toContain("deploy/service.json");
    expect(MAKEFILE).toContain("$(AIDE_DASH_LABEL)");
  });

  test("the board's banner shows that warning, not only the tools one", () => {
    expect(SHELL).toContain("[aide (tools|serve)");
  });
});
