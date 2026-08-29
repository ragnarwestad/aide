// GET /schedule-output/<project>/<specFolder>/... (spec 272): whatever a
// schedule step wrote to its own output directory, served with the same
// `serveStatic()` primitive the generated site already uses, pointed at
// a different root. Acceptance criteria 2-4, 8.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scheduleOutputDir } from "../../src/queue/schedule.ts";
import { queueHarness } from "../helpers/queue-server.ts";

const harness = queueHarness("aide-schedule-output-route-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const TOKEN = "s3cret-token";

function freshOutputRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aide-schedule-output-"));
  ownDirs.push(root);
  return root;
}

function writeOutput(outputRoot: string, project: string, specFolder: string, html: string): void {
  const dir = scheduleOutputDir(outputRoot, project, specFolder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
}

describe("GET /schedule-output/... (spec 272)", () => {
  test("a file written under the fixture root is served with a valid token", async () => {
    const outputRoot = freshOutputRoot();
    writeOutput(outputRoot, "aide", "schedule-nightly-report", "<h1>traffic</h1>");
    const { base } = harness.start({ extra: { queueToken: TOKEN, scheduleOutputRoot: outputRoot } });
    const res = await fetch(`${base}/schedule-output/aide/schedule-nightly-report/index.html`, {
      headers: { "x-aide-token": TOKEN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("<h1>traffic</h1>");
  });

  test("a missing file is 404, not a crash", async () => {
    const outputRoot = freshOutputRoot();
    const { base } = harness.start({ extra: { queueToken: TOKEN, scheduleOutputRoot: outputRoot } });
    const res = await fetch(`${base}/schedule-output/aide/schedule-nightly-report/index.html`, {
      headers: { "x-aide-token": TOKEN },
    });
    expect(res.status).toBe(404);
  });

  test("no token is 401", async () => {
    const outputRoot = freshOutputRoot();
    writeOutput(outputRoot, "aide", "schedule-nightly-report", "<h1>traffic</h1>");
    const { base } = harness.start({ extra: { queueToken: TOKEN, scheduleOutputRoot: outputRoot } });
    const res = await fetch(`${base}/schedule-output/aide/schedule-nightly-report/index.html`);
    expect(res.status).toBe(401);
  });

  test("the wrong token is 401", async () => {
    const outputRoot = freshOutputRoot();
    writeOutput(outputRoot, "aide", "schedule-nightly-report", "<h1>traffic</h1>");
    const { base } = harness.start({ extra: { queueToken: TOKEN, scheduleOutputRoot: outputRoot } });
    const res = await fetch(`${base}/schedule-output/aide/schedule-nightly-report/index.html`, {
      headers: { "x-aide-token": "wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  test("a path-traversal attempt is 404, matching serveStatic's existing guard", async () => {
    // `..` encoded, the way `serve.test.ts`'s own traversal test does it
    // — an unencoded `..` is normalized out of the URL before the
    // request ever reaches the server, which would prove nothing about
    // the route's own guard.
    const outputRoot = freshOutputRoot();
    const { base } = harness.start({ extra: { queueToken: TOKEN, scheduleOutputRoot: outputRoot } });
    const res = await fetch(`${base}/schedule-output/..%2F..%2Fetc%2Fpasswd`, {
      headers: { "x-aide-token": TOKEN },
    });
    expect(res.status).toBe(404);
  });
});
