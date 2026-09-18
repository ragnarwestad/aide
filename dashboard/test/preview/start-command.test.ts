// Which command brings a board up for a project. Aide has a round
// script of its own; every other project says how in its manifest, and
// a project that says nothing can have no board at all — which is the
// capability check every page already gates its Start link on.
import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startCommandFor } from "../../src/serve/setup/test-servers.ts";

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

  test("the machine's own AIDE_PREVIEW_CMD wins over the manifest", () => {
    const dir = root();
    manifest(dir, "name: paceup\npreviewCmd: pnpm dev --port $PORT\n");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "config"), "AIDE_PREVIEW_CMD=npm run dev -- --port $PORT\n");

    expect(startCommandFor(dir, "aide/02-x", 8802)?.at(-1)).toBe("npm run dev -- --port $PORT");
  });

  test("a project that says nothing can have no board", () => {
    const dir = root();
    manifest(dir, "name: skjer\n");

    expect(startCommandFor(dir, "aide/1-x", 8801)).toBeUndefined();
  });
});
