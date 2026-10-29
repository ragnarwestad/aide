// The preload beside this file (bunfig.toml) gives every `bun test`
// process the same environment wherever it is started.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { sameEnv } from "./same-env";

const DASHBOARD = join(import.meta.dir, "..", "..", "..");

describe("a test process sees the same environment wherever it is started", () => {
  test("the caller's own variables are dropped and the rest kept", () => {
    const env = {
      AIDE_CHECKOUT_ROOT: "/board/checkouts", AIDE_RUN_URL: "http://127.0.0.1:8788",
      CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", GIT_DIR: "/elsewhere/.git",
      HOME: "/Users/me", LANG: "C", PATH: "/usr/bin",
    };
    expect(sameEnv(env, [])).toEqual({ HOME: "/Users/me", LANG: "C", PATH: "/usr/bin" });
  });

  test("a mise shims directory on PATH becomes the directories it points to", () => {
    const env = { PATH: "/home/me/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin" };
    expect(sameEnv(env, ["/home/me/.local/share/mise/installs/jq/latest"]).PATH)
      .toBe("/home/me/.local/share/mise/installs/jq/latest:/opt/homebrew/bin:/usr/bin");
  });

  test("the shims stay when mise cannot say where they point", () => {
    const env = { PATH: "/home/me/.local/share/mise/shims:/usr/bin" };
    expect(sameEnv(env, []).PATH).toBe(env.PATH);
  });

  test("a suite started by the board does not see its variables", () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-"));
    const probe = join(dir, "reads-the-env.test.ts");
    writeFileSync(probe,
      'import { test } from "bun:test";\n' +
      'test("env", () => { console.log("SEEN=" + JSON.stringify(' +
      '[process.env.AIDE_RUN_URL ?? null, process.env.CLAUDECODE ?? null])); });\n');
    const r = Bun.spawnSync(["bun", "test", probe], {
      cwd: DASHBOARD,
      env: { ...process.env, AIDE_RUN_URL: "http://127.0.0.1:1", CLAUDECODE: "1",
             PATH: `${homedir()}/.local/share/mise/shims:${process.env.PATH}` },
    });
    const seen = /SEEN=(\S+)/.exec(r.stdout.toString() + r.stderr.toString())?.[1];
    expect(seen).toBe("[null,null]");
  });
});
