// What a progress dialog's OK does: the question closes, the page's loading
// cover shows the dialog's word while the press is sent, and once the queue
// has the job the page goes to the Running page with the spec's row open. A
// refusal lifts the cover and asks again with the reason.

import { afterEach, describe, expect, test } from "bun:test";
import { coverWhile, submitProgress, type ProgressIo } from "../../../src/specs-client/progress-dialog";

type Listener = (e: { preventDefault(): void; defaultPrevented: boolean }) => void;

function fakeDialog() {
  const listeners: Record<string, Listener[]> = {};
  const dialog = {
    shows: 0,
    closes: 0,
    addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
    /** How many listeners of `type` are attached. */
    count: (type: string) => (listeners[type] ?? []).length,
    close() {
      dialog.closes += 1;
    },
    fire(type: string) {
      const e = { defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } };
      for (const fn of listeners[type] ?? []) fn(e);
      return e;
    },
    showModal() {
      dialog.shows += 1;
    },
  };
  return dialog;
}

interface Io extends ProgressIo {
  gone: string[];
  /** Each cover shown, by its word, and "done" when it was lifted. */
  covers: string[];
}

function fakeIo(): Io {
  const io: Io = {
    gone: [],
    covers: [],
    go: (url) => void io.gone.push(url),
    cover: (note) => void io.covers.push(note),
    uncover: () => void io.covers.push("done"),
  };
  return io;
}

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

/** The post: what the server answers, and the requests it received. */
function stubPost(status: number, body: unknown) {
  const requests: { headers: Record<string, string> }[] = [];
  (globalThis as unknown as { document: unknown }).document = { dispatchEvent: () => true, querySelectorAll: () => [] };
  (globalThis as unknown as { FormData: unknown }).FormData = class {
    forEach(): void {}
  };
  (globalThis as unknown as { location: unknown }).location = { href: "http://dash.test/", pathname: "/" };
  (globalThis as unknown as { fetch: unknown }).fetch = async (_url: string, init: { headers: Record<string, string> }) => {
    requests.push(init);
    return { ok: status < 400, status, json: async () => body };
  };
  return requests;
}

const submit = () => {
  const e = { defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } };
  return e as unknown as Event;
};

/** The ask: a dialog the posting form sits INSIDE, with a line for a refusal. */
function fakeAsk() {
  const base = fakeDialog();
  const refused = { textContent: "" };
  const ask = Object.assign(base, {
    open: false,
    showModal() {
      ask.shows += 1;
      ask.open = true;
    },
    close() {
      ask.closes += 1;
      ask.open = false;
    },
    getAttribute: (name: string) => (name === "data-cover-note" ? "Deploying…" : null),
    querySelector: (sel: string) => (sel === ".refused" ? refused : null),
  });
  const form = {
    action: "http://dash.test/api/queue",
    id: "closeask",
    dataset: { progress: "" } as Record<string, string>,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: (sel: string) => (sel.includes("data-progress-dialog") ? ask : null),
  } as unknown as HTMLFormElement;
  return { ask, form, line: refused };
}

describe("submitProgress from inside the ask", () => {
  test("posts for JSON, covers the page with the dialog's word, and goes to the Running page with the job's row open", async () => {
    const requests = stubPost(200, { ok: true, job: { id: "j1", project: "aide", specFolder: "150-x", steps: ["reopen"], stepIndex: 0 } });
    const a = fakeAsk();
    a.ask.open = true;
    const io = fakeIo();
    const event = submit();
    await submitProgress(a.form, event, io);
    expect(event.defaultPrevented).toBe(true);
    expect(a.ask.open).toBe(false);
    expect(requests[0]!.headers.accept).toBe("application/json");
    expect(io.gone).toEqual(["/?open=aide/150-x:reopen"]);
    // The cover stays until the Running page is in place.
    expect(io.covers).toEqual(["Deploying…"]);
  });

  test("an answer that names no job goes to the Running page", async () => {
    stubPost(200, { ok: true });
    const io = fakeIo();
    await submitProgress(fakeAsk().form, submit(), io);
    expect(io.gone).toEqual(["/"]);
  });

  test("a refusal lifts the cover and asks again with the reason in the box, and nothing navigates", async () => {
    stubPost(400, { error: "Give a reason." });
    const a = fakeAsk();
    a.ask.open = true;
    const io = fakeIo();
    await submitProgress(a.form, submit(), io);
    expect(io.covers).toEqual(["Deploying…", "done"]);
    expect(a.line.textContent).toBe("Problem: Give a reason.");
    expect(a.ask.open).toBe(true);
    expect(io.gone).toEqual([]);
  });
});

describe("coverWhile", () => {
  test("empties the dialog's line, closes the question and covers the page", () => {
    const a = fakeAsk();
    a.ask.open = true;
    a.line.textContent = "old";
    const io = fakeIo();
    coverWhile(a.ask as unknown as HTMLDialogElement, io);
    expect(a.line.textContent).toBe("");
    expect(a.ask.open).toBe(false);
    expect(io.covers).toEqual(["Deploying…"]);
  });

  test("release without a reason lifts the cover and leaves the question closed", () => {
    const a = fakeAsk();
    const io = fakeIo();
    coverWhile(a.ask as unknown as HTMLDialogElement, io).release();
    expect(io.covers).toEqual(["Deploying…", "done"]);
    expect(a.ask.open).toBe(false);
  });
});
