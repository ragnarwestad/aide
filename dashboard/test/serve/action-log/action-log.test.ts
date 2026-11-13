// Every action that went through leaves a line saying what was done, from
// where, and to which job, and the job keeps the same entry. A refusal is
// logged where it is refused; a read, or a check a page fires on a timer,
// leaves nothing.
import { describe, expect, test } from "bun:test";
import { logAction, requestSource } from "../../../src/serve/action-log/index.ts";

const post = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1:8788${path}`, { method: "POST", headers });
const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const recorder = () => {
  const lines: string[] = [];
  const noted: { id: string; entry: { action: string; from: string } }[] = [];
  return { lines, noted, sink: { log: (line: string) => lines.push(line), noteOnJob: (id: string, entry: { at: string; action: string; from: string }) => noted.push({ id, entry }) } };
};

describe("requestSource", () => {
  test("names the tailnet login and the device a request came through", () => {
    const req = post("/api/queue/x/cancel", {
      "tailscale-user-login": "someone@example.test",
      "x-forwarded-for": "100.104.158.73",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)",
    });
    const from = requestSource(req);
    expect(from).toContain("someone@example.test");
    expect(from).toContain("100.104.158.73");
    expect(from).toContain("iPhone");
  });

  test("says local for a request with no proxy headers", () => {
    expect(requestSource(post("/api/queue", { "user-agent": "curl/8.7.1" }))).toContain("local");
  });
});

describe("logAction", () => {
  test("logs a successful action with its source and job, and notes it on the job", async () => {
    const { lines, noted, sink } = recorder();
    const req = post("/api/queue/c445775a-8ebc/cancel", { "tailscale-user-login": "someone@example.test" });
    await logAction(sink, req, "/api/queue/c445775a-8ebc/cancel", answer({ ok: true, job: { id: "c445775a-8ebc", project: "aide", specFolder: "schedule-nightly-e2e" } }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("/api/queue/c445775a-8ebc/cancel");
    expect(lines[0]).toContain("someone@example.test");
    expect(lines[0]).toContain("aide/schedule-nightly-e2e");
    expect(noted).toEqual([{ id: "c445775a-8ebc", entry: expect.objectContaining({ action: "cancel", from: expect.stringContaining("someone@example.test") }) }]);
  });

  test("leaves a refusal, a read and a timed check alone", async () => {
    const { lines, noted, sink } = recorder();
    await logAction(sink, post("/api/queue/x/cancel"), "/api/queue/x/cancel", answer({ error: "no" }, 409));
    await logAction(sink, new Request("http://127.0.0.1:8788/api/queue"), "/api/queue", answer({ jobs: [] }));
    await logAction(sink, post("/api/queue/projects/aide/drift"), "/api/queue/projects/aide/drift", answer({ ok: true, behind: 0 }));
    expect(lines).toEqual([]);
    expect(noted).toEqual([]);
  });

  test("leaves the response readable for the browser", async () => {
    const { sink } = recorder();
    const response = answer({ ok: true, job: { id: "j1", project: "aide", specFolder: "1-first" } });
    await logAction(sink, post("/api/queue"), "/api/queue", response);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true);
  });
});
