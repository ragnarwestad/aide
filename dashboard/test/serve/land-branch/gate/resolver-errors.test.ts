import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSentence } from "../../../../src/i18n/message.ts";
import { runProjectSuiteBeforePush } from "../../../../src/serve/land-branch/test-gate.ts";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  delete process.env.AIDE_RESOLVE_TEST_CMD_BIN;
});

function git(cwd: string, ...args: string[]): void {
  const out = Bun.spawnSync({
    cmd: ["git", "-C", cwd, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (out.exitCode !== 0) throw new Error(out.stderr.toString());
}

async function verdictFor(answer: string) {
  const root = mkdtempSync(join(tmpdir(), "aide-resolver-error-"));
  const bin = mkdtempSync(join(tmpdir(), "aide-resolver-error-bin-"));
  dirs.push(root, bin);
  writeFileSync(join(root, "README.md"), "demo\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "first");
  const resolver = join(bin, "resolver");
  writeFileSync(resolver, `#!/bin/sh\nprintf '%s\\n' '${answer}'\n`, {
    mode: 0o755,
  });
  process.env.AIDE_RESOLVE_TEST_CMD_BIN = resolver;
  return runProjectSuiteBeforePush(
    root,
    { project: "demo", specFolder: "1-x" },
    "aide/1-x",
  );
}

describe("the merge test gate's resolver errors", () => {
  test("an unsuccessful answer uses the catalogue without raw output (AC-2)", async () => {
    const verdict = await verdictFor(
      '{"ok":false,"error":"RAW RESOLVER OUTPUT"}',
    );
    expect(verdict.error).toEqual({
      key: "testGate.cannotResolveCommand",
      values: { root: expect.any(String) },
    });
    expect(renderSentence("nb", verdict.error)).toContain("AIDE_TEST_CMD");
    expect(renderSentence("nb", verdict.error)).not.toContain(
      "RAW RESOLVER OUTPUT",
    );
    expect(verdict.detail).toContain("RAW RESOLVER OUTPUT");
  });

  test("an unreadable answer uses the translated catalogue sentence (AC-2)", async () => {
    const verdict = await verdictFor("not json");
    expect(verdict.error).toEqual({
      key: "testGate.cannotReadResolverAnswer",
      values: { root: expect.any(String) },
    });
    expect(renderSentence("nb", verdict.error)).toContain("testkommando");
  });
});
