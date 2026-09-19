// A form that still carries a hidden `token` field (a page served before the
// token was removed, still open in a tab) is posted to its own address, with
// no `token` parameter added.
import { describe, expect, test } from "bun:test";
import { harness, OK_ACTION } from "./fixtures.ts";

const carriesToken = (url: string) => new URL(url, "http://x").searchParams.has("token");

describe("no token parameter is appended to a press (AC-5)", () => {
  test("press: a row button posts to the form's address as it is", async () => {
    const h = harness((url) => (url.includes("/cancel") ? { ok: true, body: OK_ACTION } : { ok: true }));
    await h.submit();
    const posted = h.requests.find((r) => r.url.includes("/cancel"))!;
    expect(carriesToken(posted.url)).toBe(false);
  });

  test("tail-actions: a tail box's tick posts without it", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true, job: { id: "job-1" } } }));
    await h.changeTail(true);
    const posted = h.requests.find((r) => r.url.includes("/steps"))!;
    expect(carriesToken(posted.url)).toBe(false);
  });

  test("pending-model: a non-live model pick posts without it", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    await h.changeModel(0, "fable");
    const posted = h.requests.find((r) => r.url.includes("/api/queue/specs/"))!;
    expect(carriesToken(posted.url)).toBe(false);
  });
});
