// `GET /jobs/<id>/screenshots/<step>/<file>`: a finished step's screenshots,
// served from the folder the runner keeps beside the step's transcript, and
// the Log tab's link to each.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { screenshotsDir } from "../../src/queue/runner/run-log-path.ts";
import { queueHarness } from "../helpers/queue-server.ts";

const harness = queueHarness("aide-screenshots-route-");
afterEach(() => harness.cleanup());

const FOLDER = "81-queue-and-runner";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A board whose queue holds one finished job, with an implement step whose
 *  screenshots folder holds one picture. */
function boardWithScreenshots(): { base: string; id: string } {
  const first = harness.start();
  const mirror = join(first.dir, "queue.json");
  const stream = join(first.dir, "job.implement.stream.jsonl");
  writeFileSync(stream, "");
  mkdirSync(screenshotsDir(stream));
  writeFileSync(join(screenshotsDir(stream), "01-jobs-1440.png"), PNG);
  writeFileSync(join(first.dir, "secret.png"), "not a screenshot");
  const id = "job-with-pictures";
  writeFileSync(
    mirror,
    JSON.stringify([
      {
        id, project: "aide", specFolder: FOLDER, steps: ["implement"], stepIndex: 1, state: "done",
        timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-10-23T10:00:00Z", spentUsd: 0,
        results: [
          { step: "implement", ok: true, tool: "claude", costUsd: 0, costMeasured: true, terminalReason: "completed", streamFile: stream, at: "2026-10-23T10:05:00Z" },
        ],
      },
    ]),
  );
  const { base } = harness.start({ extra: { queueMirrorPath: mirror } });
  return { base, id };
}

describe("GET /jobs/<id>/screenshots/<step>/<file>", () => {
  test("answers a kept picture as image/png with its bytes", async () => {
    const { base, id } = boardWithScreenshots();
    const res = await fetch(`${base}/jobs/${id}/screenshots/implement/01-jobs-1440.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  test("answers 404 for a job, a step or a file it does not know, and for a name with a path in it", async () => {
    const { base, id } = boardWithScreenshots();
    const asked = [
      `/jobs/nobody/screenshots/implement/01-jobs-1440.png`,
      `/jobs/${id}/screenshots/analyze/01-jobs-1440.png`,
      `/jobs/${id}/screenshots/implement/02-other-1440.png`,
      `/jobs/${id}/screenshots/implement/..%2Fsecret.png`,
      `/jobs/${id}/screenshots/implement/..%2F..%2Fsecret.png`,
      `/jobs/${id}/screenshots/implement/01-jobs-1440.txt`,
    ];
    for (const path of asked) expect((await fetch(`${base}${path}`)).status, path).toBe(404);
  });

  test("a step run twice serves the newest attempt's folder", async () => {
    const first = harness.start();
    const older = join(first.dir, "job.implement.stream.jsonl");
    const newer = join(first.dir, "job2.implement.stream.jsonl");
    for (const [stream, bytes] of [[older, "old"], [newer, "new"]] as const) {
      writeFileSync(stream, "");
      mkdirSync(screenshotsDir(stream));
      writeFileSync(join(screenshotsDir(stream), "01-jobs-1440.png"), bytes);
    }
    const result = (streamFile: string) => ({ step: "implement", ok: true, tool: "claude", costUsd: 0, costMeasured: true, terminalReason: "completed", streamFile });
    writeFileSync(
      join(first.dir, "queue.json"),
      JSON.stringify([
        { id: "twice", project: "aide", specFolder: FOLDER, steps: ["implement"], stepIndex: 1, state: "done", timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-10-23T10:00:00Z", spentUsd: 0, results: [result(older), result(newer)] },
      ]),
    );
    const { base } = harness.start({ extra: { queueMirrorPath: join(first.dir, "queue.json") } });
    expect(await (await fetch(`${base}/jobs/twice/screenshots/implement/01-jobs-1440.png`)).text()).toBe("new");
  });

  test("the job page's Log tab links the picture", async () => {
    const { base, id } = boardWithScreenshots();
    const html = await (await fetch(`${base}/jobs/${id}?tab=steps&step=0&steptab=log`)).text();
    expect(html).toContain(`href="/jobs/${id}/screenshots/implement/01-jobs-1440.png"`);
  });
});
