// A form the page posts itself and then loads again: the spec page's
// Update, Save, banner and Status tab tick, Stop test server, a test
// board's Run, Build wiki and its Cancel, an AI's Check and a schedule
// entry's Delete. A refusal is written in the form's line and the page
// stays; a success loads it again, unless it changed nothing and the
// form names a line to say so in.

import { afterEach, describe, expect, test } from "bun:test";
import { submitReloadForm, type ReloadIo } from "../../../src/specs-client/reload-form";

const realGlobals = {
  fetch: globalThis.fetch,
  FormData: globalThis.FormData,
  location: (globalThis as { location?: unknown }).location,
  document: (globalThis as { document?: unknown }).document,
};
afterEach(() => {
  globalThis.fetch = realGlobals.fetch;
  globalThis.FormData = realGlobals.FormData;
  (globalThis as { location?: unknown }).location = realGlobals.location;
  (globalThis as { document?: unknown }).document = realGlobals.document;
});

/** The server's answer, and what the page asked it. */
function stubPost(status: number, body: unknown) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  (globalThis as unknown as { document: unknown }).document = { querySelectorAll: () => [] };
  (globalThis as unknown as { FormData: unknown }).FormData = class {
    forEach(): void {}
  };
  (globalThis as unknown as { location: unknown }).location = { href: "http://dash.test/specs/aide/81-x", pathname: "/specs/aide/81-x", search: "" };
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: { headers: Record<string, string> }) => {
    requests.push({ url, headers: init.headers });
    return { ok: status < 400, status, json: async () => body };
  };
  return requests;
}

const line = () => ({ textContent: "" });
type Line = ReturnType<typeof line>;

/** A form with one button, a line of its own, and the page's named lines. */
function fakeForm(o: { dataset?: Record<string, string>; inDialog?: boolean } = {}) {
  const own = line();
  const named: Record<string, Line> = { "spec-refused": line(), "spec-notice": line() };
  const dialog = { closes: 0, close() { dialog.closes += 1; } };
  const button = {
    textContent: "Save", title: "", disabled: false, dataset: { pending: "Saving…" } as Record<string, string>,
    classList: { contains: () => false, add() {}, remove() {} }, isConnected: true,
  };
  const form = {
    action: "http://dash.test/api/queue/specs/aide/81-x/save",
    id: "",
    dataset: o.dataset ?? {},
    querySelector: (sel: string) => (sel === ".refused" ? own : null),
    querySelectorAll: (sel: string) => (sel === "button" || sel.startsWith("button,") ? [button] : []),
    closest: (sel: string) => (sel.includes("dialog") && o.inDialog ? dialog : null),
  } as unknown as HTMLFormElement;
  const reloads: number[] = [];
  const went: string[] = [];
  const io: ReloadIo = {
    reload: () => void reloads.push(1),
    go: (href) => void went.push(href),
    line: (id) => (named[id] ?? null) as unknown as Element | null,
  };
  return { form, own, named, dialog, reloads, went, io, button };
}

const submit = () => {
  const e = { defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } };
  return e as unknown as Event;
};

describe("submitReloadForm", () => {
  test("posts for JSON and loads the page again on success (AC-6)", async () => {
    const requests = stubPost(200, { ok: true, note: "saved 1-description.md", changed: true });
    const f = fakeForm({ dataset: { line: "spec-refused", note: "spec-notice" } });
    const event = submit();
    await submitReloadForm(f.form, event, f.io);
    expect(event.defaultPrevented).toBe(true);
    expect(requests[0]!.headers.accept).toBe("application/json");
    expect(f.reloads).toHaveLength(1);
  });

  test("a refusal is written in the line the form names and the page stays (AC-6)", async () => {
    stubPost(409, { error: "another job for this spec is still running — nothing was saved" });
    const f = fakeForm({ dataset: { line: "spec-refused", note: "spec-notice" } });
    await submitReloadForm(f.form, submit(), f.io);
    expect(f.named["spec-refused"]!.textContent).toBe("Another job for this spec is still running — nothing was saved");
    expect(f.reloads).toHaveLength(0);
  });

  test("a form that names no line takes its refusal in its own (AC-6)", async () => {
    stubPost(400, { error: "unknown tool" });
    const f = fakeForm();
    await submitReloadForm(f.form, submit(), f.io);
    expect(f.own.textContent).toBe("Unknown tool");
    expect(f.reloads).toHaveLength(0);
  });

  test("a success that changed nothing leaves its note and empties the refusal line (AC-6)", async () => {
    stubPost(200, { ok: true, note: "the specs checkout was already up to date", changed: false });
    const f = fakeForm({ dataset: { line: "spec-refused", note: "spec-notice" } });
    f.named["spec-refused"]!.textContent = "An earlier refusal";
    await submitReloadForm(f.form, submit(), f.io);
    expect(f.named["spec-notice"]!.textContent).toBe("The specs checkout was already up to date");
    expect(f.named["spec-refused"]!.textContent).toBe("");
    expect(f.reloads).toHaveLength(0);
  });

  test("a success that changed nothing loads the page again when the form names no note line (AC-6)", async () => {
    stubPost(200, { ok: true, changed: false });
    const f = fakeForm();
    await submitReloadForm(f.form, submit(), f.io);
    expect(f.reloads).toHaveLength(1);
  });

  test("a refusal closes the open dialog around the form before it is written (AC-6)", async () => {
    stubPost(400, { error: "no such entry" });
    const f = fakeForm({ dataset: { line: "spec-refused" }, inDialog: true });
    await submitReloadForm(f.form, submit(), f.io);
    expect(f.dialog.closes).toBe(1);
    expect(f.named["spec-refused"]!.textContent).toBe("No such entry");
  });

  test("a form naming where to go goes there on success instead of loading the page again (AC-4)", async () => {
    stubPost(200, { ok: true });
    const f = fakeForm({ dataset: { done: "/projects/aide?tab=schedule" } });
    await submitReloadForm(f.form, submit(), f.io);
    expect(f.went).toEqual(["/projects/aide?tab=schedule"]);
    expect(f.reloads).toHaveLength(0);
  });

  test("a form naming where to go stays put on a refusal, with the reason in its line (AC-4)", async () => {
    stubPost(400, { error: "no such entry" });
    const f = fakeForm({ dataset: { done: "/projects/aide?tab=schedule", line: "spec-refused" } });
    await submitReloadForm(f.form, submit(), f.io);
    expect(f.named["spec-refused"]!.textContent).toBe("No such entry");
    expect(f.went).toEqual([]);
    expect(f.reloads).toHaveLength(0);
  });

  test("a submit another listener already took is left alone (AC-6)", async () => {
    const requests = stubPost(200, { ok: true });
    const f = fakeForm();
    const event = submit();
    event.preventDefault();
    await submitReloadForm(f.form, event, f.io);
    expect(requests).toHaveLength(0);
  });
});
