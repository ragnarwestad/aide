// A merge that drops an option from the serve code leaves the installed
// launchd job passing it, and the board refuses to start at its next
// restart (2026-09-19: `--token-file`, two minutes down). The install
// after a merge drops such options from the job's plist, and the restart
// reloads the job from that file.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPlist } from "../../deploy/render-plist.ts";
import { reloadScript } from "../../src/serve/land-branch/restart.ts";

const ROOT = join(import.meta.dir, "..", "..");
const REPAIR = join(ROOT, "deploy", "repair-serve-plist.sh");
const PARSE_ARGS = join(ROOT, "src", "serve", "serve-helpers", "parse-args.ts");
const BUDDY = "/usr/libexec/PlistBuddy";

function programArguments(plist: string): string[] {
  const out = Bun.spawnSync([BUDDY, "-c", "Print :ProgramArguments", plist]).stdout.toString();
  return out.split("\n").slice(1, -2).map((l) => l.trim());
}

describe.skipIf(!existsSync(BUDDY))("repair-serve-plist.sh", () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-repair-plist-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function plistWith(serveArgv: string[]): string {
    const path = join(dir, `${serveArgv.join("_").replace(/\W/g, "")}.plist`);
    writeFileSync(path, renderPlist({
      label: "L", bunPath: "/b/bun", script: "/s/serve.ts", workingDirectory: "/w", logPath: "/l", serveArgv,
    }));
    return path;
  }

  test("an option the code dropped goes, with its value; the rest stays in order", () => {
    const plist = plistWith(["serve", "--root", "/x/root", "--token-file", "/x/token", "--port", "8788"]);
    const res = Bun.spawnSync(["bash", REPAIR, plist, PARSE_ARGS]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain("removed --token-file");
    expect(programArguments(plist)).toEqual(["/b/bun", "run", "/s/serve.ts", "serve", "--root", "/x/root", "--port", "8788"]);
  });

  test("a job passing only accepted options is left as it was", () => {
    const plist = plistWith(["serve", "--root", "/x/root", "--port", "8788"]);
    const before = programArguments(plist);
    const res = Bun.spawnSync(["bash", REPAIR, plist, PARSE_ARGS]);

    expect(res.stdout.toString()).toBe("");
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
