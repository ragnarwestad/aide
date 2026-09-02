// Spec 358: a spec's page opens the spec as a PDF.
//
// `pdfGeneratorBin` is always a stub here — never the real
// `aide-generate-pdf` — the same reason `queueRunnerBin` and every other
// spawned binary in this suite is: no test should depend on `md-to-pdf`
// actually being installed on the machine running `bun test`. What is
// real is the filesystem and the git repository the stub and the route
// both touch, through `queueHarness`'s own fixture.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerOptions } from "../../src/serve/serve.ts";
import { queueHarness, ran } from "../helpers/queue-server.ts";

const TOKEN = "s3cret-token";
const SPEC = "81-queue-and-runner";

const harness = queueHarness("aide-spec-pdf-");

afterEach(() => harness.cleanup());

function git(cwd: string, ...args: string[]): void {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${out.stderr.toString()}`);
}

/** A stub `aide-generate-pdf`: logs its own argv (one line per call) to
 *  `logPath`, and writes recognisable bytes to whatever output path it
 *  was given — standing in for `md-to-pdf`'s own real render. */
function writeStubGenerator(binPath: string, logPath: string): void {
  writeFileSync(
    binPath,
    `#!/usr/bin/env bash\n` +
      `printf '%s\\t%s\\n' "$1" "$2" >> "${logPath}"\n` +
      `mkdir -p "$(dirname "$2")"\n` +
      `printf 'stub-pdf-for-%s' "$1" > "$2"\n`,
  );
  chmodSync(binPath, 0o755);
}

/** How many times the stub has been invoked, and with which argv —
 *  reading the log rather than trusting a cache hit not to have
 *  happened. */
function invocations(logPath: string): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
}

function start(extra: Partial<ServerOptions> = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "aide-spec-pdf-scratch-"));
  const logPath = join(scratch, "invocations.log");
  const binPath = join(scratch, "aide-generate-pdf-stub");
  writeStubGenerator(binPath, logPath);
  const cacheDir = join(scratch, "pdf-cache");
  const { base, dir, server } = harness.start({
    extra: {
      queueToken: TOKEN,
      pdfGeneratorBin: binPath,
      pdfCacheDir: cacheDir,
      pdfToolAvailable: true,
      ...extra,
    },
    archivedSpecs: { "77-old-spec": {} },
  });
  return { base, dir, server, logPath, cacheDir };
}

const auth = { headers: { "x-aide-token": TOKEN } };

describe("spec 358: GET a spec's PDF", () => {
  // REQ-8
  test("the route requires the token like every other /specs/ route", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs/aide/${SPEC}/pdf`);
    expect(res.status).toBe(401);
  });

  test("an unknown spec is 404", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs/aide/does-not-exist/pdf`, auth);
    expect(res.status).toBe(404);
  });

  // REQ-7
  test("the tool being unavailable answers 503, and spawns nothing", async () => {
    const { base, logPath } = start({ pdfToolAvailable: false });
    const res = await fetch(`${base}/specs/aide/${SPEC}/pdf`, auth);
    expect(res.status).toBe(503);
    expect(invocations(logPath)).toHaveLength(0);
  });

  // REQ-2, REQ-3
  test("an active spec's PDF is generated inline with the right headers", async () => {
    const { base, dir, logPath } = start();
    ran(dir, []);
    const res = await fetch(`${base}/specs/aide/${SPEC}/pdf`, auth);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="${SPEC}.pdf"`);
    expect(await res.text()).toBe(`stub-pdf-for-${SPEC}`);
    const calls = invocations(logPath);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(SPEC);
  });

  // REQ-1b, REQ-3: the archived spec's own identifier, not the bare folder.
  test("an archived spec is generated with the archive/ prefix", async () => {
    const { base, dir, logPath } = start();
    ran(dir, []);
    const res = await fetch(`${base}/specs/aide/77-old-spec/pdf`, auth);
    expect(res.status).toBe(200);
    const calls = invocations(logPath);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("archive/77-old-spec");
  });

  // REQ-5
  test("a second press with no new commit serves the cache and spawns nothing more", async () => {
    const { base, dir, logPath } = start();
    ran(dir, []);
    await fetch(`${base}/specs/aide/${SPEC}/pdf`, auth);
    expect(invocations(logPath)).toHaveLength(1);
    const res2 = await fetch(`${base}/specs/aide/${SPEC}/pdf`, auth);
    expect(res2.status).toBe(200);
    expect(invocations(logPath)).toHaveLength(1);
  });

  // REQ-5
  test("a commit landing on the spec folder invalidates the cache", async () => {
    const { base, dir, logPath } = start();
    ran(dir, []);
    await fetch(`${base}/specs/aide/${SPEC}/pdf`, auth);
    expect(invocations(logPath)).toHaveLength(1);
    const specDir = join(dir, "root", "aide", "specs", SPEC);
    writeFileSync(join(specDir, "1-description.md"), "# Queue - Description\n\nUpdated.\n");
    git(join(dir, "root"), "add", "-A");
    git(join(dir, "root"), "commit", "-qm", "edit description");
    const res2 = await fetch(`${base}/specs/aide/${SPEC}/pdf`, auth);
    expect(res2.status).toBe(200);
    expect(invocations(logPath)).toHaveLength(2);
  });

  // REQ-4, REQ-9a
  test("nothing is written into the specs checkout", async () => {
    const { base, dir } = start();
    ran(dir, []);
    const root = join(dir, "root");
    const before = Bun.spawnSync({ cmd: ["git", "-C", root, "status", "--porcelain"], stdout: "pipe" }).stdout.toString();
    const res = await fetch(`${base}/specs/aide/${SPEC}/pdf`, auth);
    expect(res.status).toBe(200);
    const after = Bun.spawnSync({ cmd: ["git", "-C", root, "status", "--porcelain"], stdout: "pipe" }).stdout.toString();
    expect(after).toBe(before);
  });

  test("a nonzero exit from the generator is a 502, and nothing is cached", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "aide-spec-pdf-scratch-"));
    const binPath = join(scratch, "failing-generator");
    writeFileSync(binPath, `#!/usr/bin/env bash\necho "boom" >&2\nexit 1\n`);
    chmodSync(binPath, 0o755);
    const { base, dir, cacheDir } = start({ pdfGeneratorBin: binPath });
    ran(dir, []);
    const res = await fetch(`${base}/specs/aide/${SPEC}/pdf`, auth);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("boom");
    // The parent directory is made ahead of the spawn (so the generator
    // has somewhere to write); no *.pdf file inside it is what "nothing
    // was cached" actually means.
    const specCacheDir = join(cacheDir, "aide", SPEC);
    const entries = existsSync(specCacheDir) ? readdirSync(specCacheDir) : [];
    expect(entries.some((e) => e.endsWith(".pdf"))).toBe(false);
  });
});
