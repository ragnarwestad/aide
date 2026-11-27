// A merge that drops an option from the serve code leaves the installed
// launchd job passing it, and the board refuses to start at its next
// restart (2026-09-19: `--token-file`, two minutes down). The install
// after a merge drops such options from the job's plist, and the restart
// reloads the job from that file.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPlist } from "../../deploy/render-plist.ts";
import { reloadScript } from "../../src/serve/deployment";

const ROOT = join(import.meta.dir, "..", "..");
const REPAIR = join(ROOT, "deploy", "repair-serve-plist.sh");
const DEFINITION = join(ROOT, "deploy", "serve-args.json");
const BUDDY = "/usr/libexec/PlistBuddy";

function programArguments(plist: string): string[] {
  const out = Bun.spawnSync([BUDDY, "-c", "Print :ProgramArguments", plist]).stdout.toString();
  return out.split("\n").slice(1, -2).map((l) => l.trim());
}

const dir = mkdtempSync(join(tmpdir(), "aide-repair-plist-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function plistWith(serveArgv: string[]): string {
  const path = join(dir, `${serveArgv.join("_").replace(/\W/g, "")}.plist`);
  writeFileSync(path, renderPlist({
    label: "L", bunPath: "/b/bun", script: "/s/serve.ts", workingDirectory: "/w", logPath: "/l", serveArgv,
  }));
  return path;
}

/** A definition file in the shape of deploy/serve-args.json, naming
 *  only the flags given, each taking a value. */
function definitionWith(flags: string[]): string {
  const path = join(dir, `def-${flags.join("_").replace(/\W/g, "")}.json`);
  const lines = flags.map((f) => `  "${f}": { "takesValue": true }`);
  writeFileSync(path, `{\n${lines.join(",\n")}\n}\n`);
  return path;
}

describe.skipIf(!existsSync(BUDDY))("repair-serve-plist.sh against deploy/serve-args.json", () => {
  test("an option the code dropped goes, with its value; the rest stays in order", () => {
    const plist = plistWith(["serve", "--root", "/x/root", "--token-file", "/x/token", "--port", "8788"]);
    const res = Bun.spawnSync(["bash", REPAIR, plist, DEFINITION]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("removed --token-file");
    expect(programArguments(plist)).toEqual(["/b/bun", "run", "/s/serve.ts", "serve", "--root", "/x/root", "--port", "8788"]);
  });

  test("every defined flag passed with a value is left as it was, whatever the parser's text (AC-1)", () => {
    const flags = Object.keys(JSON.parse(readFileSync(DEFINITION, "utf8")) as Record<string, unknown>);
    expect(flags.length).toBeGreaterThan(5);
    const plist = plistWith(["serve", ...flags.flatMap((f, n) => [f, `/v/${n}`])]);
    const before = programArguments(plist);
    const res = Bun.spawnSync(["bash", REPAIR, plist, DEFINITION]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toBe("");
    expect(programArguments(plist)).toEqual(before);
  });

  test("a defined flag whose value begins with -- keeps that value (AC-3)", () => {
    const plist = plistWith(["serve", "--root", "--odd-value", "--port", "8788"]);
    const before = programArguments(plist);
    const res = Bun.spawnSync(["bash", REPAIR, plist, DEFINITION]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toBe("");
    expect(programArguments(plist)).toEqual(before);
  });
});

describe.skipIf(!existsSync(BUDDY))("repair-serve-plist.sh against a definition of its own", () => {

  test("a removed flag's value goes even when it begins with -- (AC-2)", () => {
    const plist = plistWith(["serve", "--root", "--odd-value", "--port", "8788"]);
    const res = Bun.spawnSync(["bash", REPAIR, plist, definitionWith(["--port"])]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("removed --root");
    expect(programArguments(plist)).toEqual(["/b/bun", "run", "/s/serve.ts", "serve", "--port", "8788"]);
  });

  test("a removed flag directly followed by a defined flag goes alone (AC-2)", () => {
    const plist = plistWith(["serve", "--verbose", "--port", "8788"]);
    const res = Bun.spawnSync(["bash", REPAIR, plist, definitionWith(["--port"])]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("removed --verbose");
    expect(programArguments(plist)).toEqual(["/b/bun", "run", "/s/serve.ts", "serve", "--port", "8788"]);
  });

  test("a definition it reads no flag from is refused, and the job is left as it was", () => {
    const plist = plistWith(["serve", "--root", "/x/empty", "--port", "8788"]);
    const before = programArguments(plist);
    const empty = join(dir, "empty.json");
    writeFileSync(empty, "{}\n");
    const res = Bun.spawnSync(["bash", REPAIR, plist, empty]);

    expect(res.exitCode).not.toBe(0);
    expect(programArguments(plist)).toEqual(before);
  });
});

describe("the restart reloads the job from its plist", () => {
  const script = reloadScript("com.example.serve");

  test("it takes the job down, waits for it to go, then loads the plist", () => {
    const bootout = script.indexOf("launchctl bootout gui/$(id -u)/com.example.serve");
    const wait = script.indexOf("launchctl print gui/$(id -u)/com.example.serve");
    const bootstrap = script.indexOf('launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.example.serve.plist"');

    expect(bootout).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(bootout);
    expect(bootstrap).toBeGreaterThan(wait);
  });

  // kickstart restarts on the arguments the job was loaded with, so a
  // repaired plist would never be read.
  test("it never restarts on the loaded arguments alone", () => {
    expect(script).not.toContain("kickstart");
  });
});
