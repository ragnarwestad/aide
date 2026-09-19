// Spec 500: the rows carry an unfolded phase's messages, follow the
// transcript as it grows, and every press keeps the fold in the address.

import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness } from "../helpers/queue-server.ts";

const harness = queueHarness("aide-phase-messages-");
afterEach(() => harness.cleanup());

const FOLDER = "81-queue-and-runner";
const KEY = `aide/${FOLDER}:analyze`;
const said = (text: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }) + "\n";

async function enqueue(base: string): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: FOLDER, steps: ["analyze"] }),
  });
  return ((await res.json()) as { job: { id: string } }).job.id;
}

describe("GET /?rows=1&phases=…", () => {
  test("a message the transcript gains between two requests appears last, and the phase stays unfolded (AC-3)", async () => {
    const { base, dir } = harness.start();
    const id = await enqueue(base);
    const stream = join(dir, "analyze.stream.jsonl");
    writeFileSync(stream, said("first message"));
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "done";
    job.results = [{ step: "analyze", ok: true, tool: "claude", costUsd: 0, costMeasured: true, terminalReason: "completed", streamFile: stream, at: "2026-09-19T10:00:00Z" }];
    writeFileSync(mirror, JSON.stringify(jobs));

    const { base: base2 } = harness.start({ extra: { queueMirrorPath: mirror } });
    const url = `${base2}/?rows=1&open=${encodeURIComponent(`aide/${FOLDER}`)}&phases=${encodeURIComponent(KEY)}`;
    const first = await (await fetch(url)).text();
    expect(first).toContain("first message");

    appendFileSync(stream, said("second message"));
    const second = await (await fetch(url)).text();
    expect(second.indexOf("second message")).toBeGreaterThan(second.indexOf("first message"));
    expect(second).toMatch(/<a class="fold[^"]*"[^>]*aria-expanded="true"/);
  });
});

describe("a press on the row keeps the fold (AC-3)", () => {
  test("a form that carries view.phases is redirected to an address with phases= (AC-3)", async () => {
    const { base } = harness.start();
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ project: "aide", specFolder: FOLDER, steps: "analyze", "view.phases": KEY }).toString(),
    });
    const location = res.headers.get("location") ?? "";
    expect(location).toContain(`phases=${encodeURIComponent(KEY)}`);
  });
});
