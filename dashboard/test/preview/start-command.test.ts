// Which command brings a board up for a project. Aide has a round
// script of its own; every other project says how in its manifest, and
// a project that says nothing can have no board at all — which is the
// capability check every page already gates its Start link on.
import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startCommandFor, testServerOffered } from "../../src/serve/setup/test-servers.ts";

const dirs: string[] = [];
const root = (): string => {
  const d = mkdtempSync(join(tmpdir(), "aide-preview-cmd-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const manifest = (dir: string, text: string): void => {
  mkdirSync(join(dir, ".aide"), { recursive: true });
  writeFileSync(join(dir, ".aide", "project.yaml"), text);
};

describe("what starts a board for a project", () => {
  test("a checkout carrying the round script starts the round, as it always did", () => {
    const dir = root();
    mkdirSync(join(dir, "dashboard", "test", "round"), { recursive: true });
    mkdirSync(join(dir, "dashboard", "src", "serve"), { recursive: true });
    writeFileSync(join(dir, "dashboard", "test", "round", "run"), "#!/bin/bash\n");
    writeFileSync(join(dir, "dashboard", "src", "serve", "serve.ts"), "");

    expect(startCommandFor(dir, "aide/1-x", 8801)).toEqual([
      join(dir, "dashboard", "test", "round", "run"),
      dir, "--branch", "aide/1-x", "--port", "8801", "--keep",
    ]);
  });

  test("any other project starts its own command through aide-preview", () => {
    const dir = root();
    manifest(dir, "name: paceup\npreviewCmd: pnpm dev --port $PORT\n");

    expect(startCommandFor(dir, "aide/02-x", 8802)).toEqual([
      join(homedir(), ".local", "bin", "aide-preview"),
      dir, "--branch", "aide/02-x", "--port", "8802", "--cmd", "pnpm dev --port $PORT",
    ]);
  });

  test("the manifest wins; the machine's own AIDE_PREVIEW_CMD is not read (AC-4)", () => {
    const dir = root();
    manifest(dir, "name: paceup\npreviewCmd: pnpm dev --port $PORT\n");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "config"), "AIDE_PREVIEW_CMD=npm run dev -- --port $PORT\n");

    expect(startCommandFor(dir, "aide/02-x", 8802)?.at(-1)).toBe("pnpm dev --port $PORT");
  });

  test("a project that says nothing can have no board", () => {
    const dir = root();
    manifest(dir, "name: skjer\n");

    expect(startCommandFor(dir, "aide/1-x", 8801)).toBeUndefined();
  });
});

describe("whether a test server is offered for a project", () => {
  const roundScript = (dir: string): void => {
    mkdirSync(join(dir, "dashboard", "test", "round"), { recursive: true });
    mkdirSync(join(dir, "dashboard", "src", "serve"), { recursive: true });
    writeFileSync(join(dir, "dashboard", "test", "round", "run"), "#!/bin/bash\n");
    writeFileSync(join(dir, "dashboard", "src", "serve", "serve.ts"), "");
  };

  test("command with a round script or a previewCmd is offered (AC-3)", () => {
    const withRound = root();
    manifest(withRound, "name: a\ndeployment:\n  previewFrom: command\n");
    roundScript(withRound);
    const withCmd = root();
    manifest(withCmd, "name: a\npreviewCmd: pnpm dev --port $PORT\ndeployment:\n  previewFrom: command\n");

    expect(testServerOffered(withRound)).toBe(true);
    expect(testServerOffered(withCmd)).toBe(true);
  });

  test("command with nothing that can start a board is not offered (AC-3)", () => {
    const dir = root();
    manifest(dir, "name: a\ndeployment:\n  previewFrom: command\n");

    expect(testServerOffered(dir)).toBe(false);
  });

  test("none, no setting and cloudflare-pages are not offered, though a previewCmd could start a board (AC-4, AC-1)", () => {
    for (const deployment of ["deployment:\n  previewFrom: none\n", "", "deployment:\n  previewFrom: cloudflare-pages\n"]) {
      const dir = root();
      manifest(dir, `name: a\npreviewCmd: pnpm dev --port $PORT\n${deployment}`);
      expect(testServerOffered(dir)).toBe(false);
    }
  });

  test("Aide's own manifest says command, so its row keeps the test server (AC-3)", () => {
    const aide = join(import.meta.dir, "..", "..", "..");

    expect(testServerOffered(aide)).toBe(true);
  });
});
