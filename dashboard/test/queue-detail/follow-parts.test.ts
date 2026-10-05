// `?follow=1` on a job page and on a spec's Steps tab: the page's moving
// parts alone, drawn by the same functions as the page.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "../helpers/queue-server.ts";

const harness = queueHarness("aide-follow-parts-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const FOLDER = "81-queue-and-runner";
const said = (text: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }) + "\n";

async function enqueue(base: string): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: FOLDER, steps: ["analyze"] }),
  });
  return ((await res.json()) as { job: { id: string } }).job.id;
}

/** A server whose runner stays alive until the test ends (bounded, so the
 *  stand-in cannot outlive it), with one job running its analyze step. */
async function runningJob(): Promise<{ base: string; id: string; stream: string }> {
  const own = mkdtempSync(join(tmpdir(), "aide-follow-runner-"));
  ownDirs.push(own);
  const fakeRunner = join(own, "fake-run-spec");
  writeFileSync(fakeRunner, `#!/bin/sh\nn=0\nwhile [ ! -f ${join(own, "go")} ] && [ $n -lt 400 ]; do sleep 0.05; n=$((n+1)); done\n`, { mode: 0o755 });
  const results = join(own, "jobs");
  const { base } = harness.start({ extra: { queueRunnerBin: fakeRunner, queueResultDir: results, queuePollMs: 50 } });
  const id = await enqueue(base);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const body = (await (await fetch(`${base}/api/queue/${id}`)).json()) as { job: { state: string } };
    if (body.job.state === "running") break;
    await Bun.sleep(100);
  }
  const stream = join(results, `${id}.analyze.stream.jsonl`);
  return { base, id, stream };
}

describe("the follow answer of a running job (AC-2)", () => {
  test("a job page and a Steps tab each answer the marker, a head and a panel holding the log, and no page (AC-2)", async () => {
    const { base, id, stream } = await runningJob();
    writeFileSync(stream, said("the line X"));
    for (const url of [`/jobs/${id}?tab=steps&follow=1`, `/specs/aide/${FOLDER}?tab=steps&follow=1`]) {
      const html = await (await fetch(`${base}${url}`)).text();
      expect(html, url).toContain("data-follow");
      expect(html, url).toContain('data-follow-part="head"');
      expect(html, url).toContain('data-follow-part="panel"');
      expect(html, url).toContain("the line X");
      expect(html, url).not.toContain("<html");
      expect(html, url).not.toContain("<header");
      expect(html, url).not.toContain("tab=overview");
      expect(html, url).not.toContain("tab=description");
    }
  }, 30000);
});

describe("the follow answer of a job whose step has just finished (AC-6)", () => {
  test("its panel holds the finished row, open, and the answer carries no marker (AC-6)", async () => {
    const { base, dir } = harness.start();
    const id = await enqueue(base);
    const stream = join(dir, "analyze.stream.jsonl");
    writeFileSync(stream, said("the last words"));
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "done";
    job.results = [{ step: "analyze", ok: true, tool: "claude", costUsd: 0, costMeasured: true, terminalReason: "completed", streamFile: stream, at: "2026-09-19T10:00:00Z" }];
    writeFileSync(mirror, JSON.stringify(jobs));

    const { base: again } = harness.start({ extra: { queueMirrorPath: mirror } });
    const html = await (await fetch(`${again}/jobs/${id}?tab=steps&step=0&follow=1`)).text();
    expect(html).toContain('data-follow-part="panel"');
    expect(html).toContain("the last words");
    expect(html).toContain("completed");
    expect(html).not.toContain("data-follow ");
    expect(html).not.toContain("data-follow>");
  });
});
