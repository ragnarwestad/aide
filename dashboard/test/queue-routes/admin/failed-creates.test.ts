// The round trip a person makes after a create failed (spec 506): the
// message is first on `/`, "Try again" fills New spec, Dismiss hides it,
// a restart keeps what was not dismissed. Through a real server.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();
const dirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const record = (id: string, over: Record<string, unknown> = {}) => ({
  id, project: "aide", title: `Title of ${id}`, description: `Line one\nline "two" <b> & ${id}`,
  reason: { key: "runner.serverRestarted", values: { button: "Create" } },
  failedAt: `2026-09-19T17:0${id === "first" ? 1 : 2}:00.000Z`, ...over,
});

function served(records: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "aide-failed-creates-"));
  dirs.push(dir);
  const failedCreatesPath = join(dir, "failed-creates.json");
  writeFileSync(failedCreatesPath, JSON.stringify(records));
  const { base } = start({ failedCreatesPath });
  return { base, failedCreatesPath };
}

const home = async (base: string) => await (await fetch(`${base}/`)).text();
const dismiss = (base: string, id: string, json = true) =>
  fetch(`${base}/api/queue/failed-creates/${id}/dismiss`, {
    method: "POST",
    headers: json ? { accept: "application/json" } : {},
    redirect: "manual",
  });

describe("a failed create on the Specs list", () => {
  test("is a message first on the page, with project, title and reason (AC-2)", async () => {
    const s = served([record("first")]);
    const html = await home(s.base);
    expect(html).toContain("Creating “Title of first” in aide failed: the server restarted");
    expect(html.indexOf("Title of first")).toBeLessThan(html.indexOf("<table"));
  });

  test("is there again when the server is rebuilt on the same file (AC-4)", async () => {
    const s = served([record("first")]);
    expect(await home(s.base)).toContain("Title of first");
    const again = start({ failedCreatesPath: s.failedCreatesPath });
    expect(await home(again.base)).toContain("Title of first");
  });

  test("the rows swap carries it too, so a refresh does not lose it (AC-4)", async () => {
    const s = served([record("first")]);
    const rows = await (await fetch(`${s.base}/?rows=1`)).text();
    expect(rows).toContain("Title of first");
  });

  test("a corrupt file starts the server and draws the list without a message (AC-4)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-failed-creates-"));
    dirs.push(dir);
    const failedCreatesPath = join(dir, "failed-creates.json");
    writeFileSync(failedCreatesPath, "{oops");
    const { base } = start({ failedCreatesPath });
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("failedcreate");
  });

  test("two messages, newest first; dismissing one leaves the other (AC-5)", async () => {
    const s = served([record("first"), record("second")]);
    const html = await home(s.base);
    expect(html.indexOf("Title of second")).toBeLessThan(html.indexOf("Title of first"));
    expect((await dismiss(s.base, "second")).status).toBe(200);
    const after = await home(s.base);
    expect(after).not.toContain("Title of second");
    expect(after).toContain("Title of first");
  });

  test("dismissing twice still answers ok; the no-script answer is a 303 to / (AC-5)", async () => {
    const s = served([record("first")]);
    expect(await (await dismiss(s.base, "first")).json()).toEqual({ ok: true });
    expect(await (await dismiss(s.base, "first")).json()).toEqual({ ok: true });
    const plain = await dismiss(s.base, "first", false);
    expect(plain.status).toBe(303);
    expect(plain.headers.get("location")).toBe("/");
    expect((await dismiss(s.base, "nothing")).status).toBe(404);
  });

  test("a dismissal stays dismissed across a restart (AC-4)", async () => {
    const s = served([record("first"), record("second")]);
    await dismiss(s.base, "first");
    const again = start({ failedCreatesPath: s.failedCreatesPath });
    const html = await home(again.base);
    expect(html).not.toContain("Title of first");
    expect(html).toContain("Title of second");
  });
});

describe("Try again opens New spec filled in (AC-3, AC-6)", () => {
  test("the project, title and description come from the record", async () => {
    const s = served([record("first")]);
    const html = await (await fetch(`${s.base}/new?retry=first`)).text();
    expect(html).toContain(`<option value="aide" selected>aide</option>`);
    expect(html).toContain(`value="Title of first"`);
    expect(html).toContain(`Line one\nline &quot;two&quot; &lt;b&gt; &amp; first</textarea>`);
  });

  test("also after the message was dismissed, as a tap on the notification would", async () => {
    const s = served([record("first")]);
    await dismiss(s.base, "first");
    expect(await home(s.base)).not.toContain("Title of first");
    expect(await (await fetch(`${s.base}/new?retry=first`)).text()).toContain(`value="Title of first"`);
  });

  test("an unknown id gives the empty form", async () => {
    const s = served([record("first")]);
    const html = await (await fetch(`${s.base}/new?retry=nope`)).text();
    expect(html).toContain(`<option value="" selected>`);
    expect(html).not.toContain("Title of first");
  });
});
