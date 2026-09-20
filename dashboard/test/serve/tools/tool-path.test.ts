// The PATH this server hands anything it spawns.
//
// The bug this file pins: the tool check ran `aide-preflight` with the
// server's own PATH and reported Claude Code as not installed, while a
// real step found it every time. The server runs under launchd, whose
// PATH does not carry `~/.local/bin`, and that is where both aide's own
// scripts and Claude Code live. A step's spawn had always prepended it;
// the check, written later, had not.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScript } from "../../../src/serve/land-branch/run-script.ts";
import { extraPathDirs, pathWithToolDirs, spawnEnv } from "../../../src/serve/tool-path.ts";

const dirs: string[] = [];
const home = () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-tool-path-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".local", "bin"), { recursive: true });
  return dir;
};

let savedHome: string | undefined;
let savedPath: string | undefined;

afterEach(() => {
  if (savedHome !== undefined) process.env.HOME = savedHome;
  if (savedPath !== undefined) process.env.PATH = savedPath;
  savedHome = undefined;
  savedPath = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pathWithToolDirs", () => {
  test("~/.local/bin is prepended when launchd's PATH does not carry it", () => {
    const dir = home();
    const path = pathWithToolDirs({ HOME: dir, PATH: "/usr/bin:/bin" } as NodeJS.ProcessEnv);
    expect(path).toBe(`${join(dir, ".local", "bin")}:/usr/bin:/bin`);
  });

  test("mise's shims are prepended too, which is where three of the four CLIs live", () => {
    const dir = home();
    mkdirSync(join(dir, ".local", "share", "mise", "shims"), { recursive: true });
    const path = pathWithToolDirs({ HOME: dir, PATH: "/usr/bin" } as NodeJS.ProcessEnv);
    expect(path).toContain(join(dir, ".local", "share", "mise", "shims"));
    expect(path).toContain(join(dir, ".local", "bin"));
    expect(path.endsWith("/usr/bin")).toBe(true);
  });

  test("MISE_DATA_DIR moves where the shims are looked for", () => {
    const dir = home();
    const data = join(dir, "elsewhere");
    mkdirSync(join(data, "shims"), { recursive: true });
    const path = pathWithToolDirs({ HOME: dir, MISE_DATA_DIR: data, PATH: "/usr/bin" } as NodeJS.ProcessEnv);
    expect(path).toContain(join(data, "shims"));
  });

  test("a directory that does not exist is not added at all", () => {
    const dir = home();
    // No mise on this machine: only ~/.local/bin, which home() made.
    expect(extraPathDirs({ HOME: dir, PATH: "" } as NodeJS.ProcessEnv)).toEqual([
      join(dir, ".local", "bin"),
    ]);
  });

  test("a PATH that already carries a directory is left exactly as it is", () => {
    const dir = home();
    const already = `/usr/bin:${join(dir, ".local", "bin")}:/bin`;
    const path = pathWithToolDirs({ HOME: dir, PATH: already } as NodeJS.ProcessEnv);
    expect(path).toBe(already);
  });

  test("an operator's own PATH is kept, never replaced", () => {
    const dir = home();
    const path = pathWithToolDirs({ HOME: dir, PATH: "/opt/mine:/usr/bin" } as NodeJS.ProcessEnv);
    expect(path).toContain("/opt/mine");
    expect(path).toContain("/usr/bin");
  });

  test("spawnEnv keeps the rest of the environment", () => {
    const dir = home();
    const env = spawnEnv({ HOME: dir, PATH: "/usr/bin", KEEP: "yes" } as NodeJS.ProcessEnv);
    expect(env.KEEP).toBe("yes");
    expect(env.PATH).toBe(`${join(dir, ".local", "bin")}:/usr/bin`);
  });
});

describe("runScript, the way the tool check calls it", () => {
  // The whole point, stated as the failure that was reported: a binary
  // that lives only in ~/.local/bin is found by name. Take the prepend
  // out of tool-path.ts and this goes red while everything else stays
  // green.
  test("a binary only in ~/.local/bin is found by name", async () => {
    const dir = home();
    const probe = join(dir, ".local", "bin", "aide-fake-cli");
    writeFileSync(probe, "#!/bin/sh\necho found-it\n");
    chmodSync(probe, 0o755);

    savedHome = process.env.HOME;
    savedPath = process.env.PATH;
    process.env.HOME = dir;
    // launchd's shape: no ~/.local/bin anywhere in it.
    process.env.PATH = "/usr/bin:/bin";

    const result = await runScript(["aide-fake-cli"], dir, 10_000);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("found-it");
  });

  test("the spawned process sees ~/.local/bin ahead of the rest", async () => {
    const dir = home();
    const script = join(dir, "say-path");
    writeFileSync(script, '#!/bin/sh\nprintf "%s" "$PATH"\n');
    chmodSync(script, 0o755);

    savedHome = process.env.HOME;
    savedPath = process.env.PATH;
    process.env.HOME = dir;
    process.env.PATH = "/usr/bin:/bin";

    const result = await runScript([script], dir, 10_000);
    expect(result.stdout.startsWith(join(dir, ".local", "bin"))).toBe(true);
  });
});
