// The hold every progress dialog is kept open by while its press is under
// way, and the Reopen and Close dialogs' OK: the dialog stands while the
// press is sent, and once the queue has the job the page goes to the
// Running page with the spec's row open.

import { afterEach, describe, expect, test } from "bun:test";
import { isStanding, standOpen, submitProgress, type ProgressIo } from "../../../src/specs-client/progress-dialog";

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
  restore?: () => void;
}

function fakeIo(): Io {
  const io: Io = {
    gone: [],
    go: (url) => void io.gone.push(url),
    onRestore: (fn) => void (io.restore = fn),
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
  const attrs = new Set<string>();
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
    setAttribute: (name: string) => void attrs.add(name),
    removeAttribute: (name: string) => void attrs.delete(name),
    hasAttribute: (name: string) => attrs.has(name),
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
  return { ask, form, line: refused, standing: () => attrs.has("data-standing") };
}

describe("submitProgress from inside the ask", () => {
  test("posts for JSON, stands while it is sent, and goes to the Running page with the spec's row open", async () => {
    const requests = stubPost(200, { ok: true, job: { id: "j1", project: "aide", specFolder: "150-x" } });
    const a = fakeAsk();
    const io = fakeIo();
    const event = submit();
    await submitProgress(a.form, event, io);
    expect(event.defaultPrevented).toBe(true);
    expect(a.ask.shows).toBe(1);
    expect(requests[0]!.headers.accept).toBe("application/json");
    expect(io.gone).toEqual(["/?open=aide/150-x"]);
    // It stands until the Running page replaces this one.
    expect(a.standing()).toBe(true);
    expect(a.ask.closes).toBe(0);
  });

  test("an answer that names no job goes to the Running page", async () => {
    stubPost(200, { ok: true });
    const io = fakeIo();
    await submitProgress(fakeAsk().form, submit(), io);
    expect(io.gone).toEqual(["/"]);
  });

  test("a refusal is written in the box, which stays open, is not standing, and nothing navigates (AC-3)", async () => {
    stubPost(400, { error: "Give a reason." });
    const a = fakeAsk();
    const io = fakeIo();
    await submitProgress(a.form, submit(), io);
    expect(a.line.textContent).toBe("Give a reason.");
    expect(a.ask.closes).toBe(0);
    expect(a.standing()).toBe(false);
    expect(io.gone).toEqual([]);
  });
});

describe("standOpen, the one hold", () => {
  const restoring = () => {
    const io = { restore: undefined as (() => void) | undefined, onRestore: (fn: () => void) => void (io.restore = fn) };
    return io;
  };

  test("opens the dialog as a modal, marks it standing and empties its line (AC-2)", () => {
    const a = fakeAsk();
    a.line.textContent = "old";
    standOpen(a.ask as unknown as HTMLDialogElement, restoring());
    expect(a.ask.shows).toBe(1);
    expect(a.standing()).toBe(true);
    expect(isStanding(a.ask as unknown as HTMLDialogElement)).toBe(true);
    expect(a.line.textContent).toBe("");
  });

  test("a dialog already open is not opened again (AC-2)", () => {
    const a = fakeAsk();
    a.ask.open = true;
    standOpen(a.ask as unknown as HTMLDialogElement, restoring());
    expect(a.ask.shows).toBe(0);
  });

  test("Escape is prevented while it is held, and not once it is released (AC-2)", () => {
    const a = fakeAsk();
    const hold = standOpen(a.ask as unknown as HTMLDialogElement, restoring());
    expect(a.ask.fire("cancel").defaultPrevented).toBe(true);
    hold.release();
    expect(a.ask.fire("cancel").defaultPrevented).toBe(false);
    expect(isStanding(a.ask as unknown as HTMLDialogElement)).toBe(false);
  });

  test("a browser that closes the held dialog anyway gets it shown again, and a close after release is left alone (AC-2)", () => {
    const a = fakeAsk();
    const hold = standOpen(a.ask as unknown as HTMLDialogElement, restoring());
    a.ask.close();
    a.ask.fire("close");
    expect(a.ask.shows).toBe(2);
    expect(a.ask.open).toBe(true);
    hold.release();
    a.ask.close();
    a.ask.fire("close");
    expect(a.ask.shows).toBe(2);
    expect(a.ask.open).toBe(false);
  });

  test("two holds of one dialog attach one listener of each kind (AC-2)", () => {
    const a = fakeAsk();
    const io = restoring();
    let restores = 0;
    const counting = { onRestore: (fn: () => void) => { restores += 1; io.onRestore(fn); } };
    standOpen(a.ask as unknown as HTMLDialogElement, counting).release();
    standOpen(a.ask as unknown as HTMLDialogElement, counting);
    expect(a.ask.count("cancel")).toBe(1);
    expect(a.ask.count("close")).toBe(1);
    expect(restores).toBe(1);
  });

  test("a restore from the cache closes it, releases it and empties its line (AC-2)", () => {
    const a = fakeAsk();
    const io = restoring();
    standOpen(a.ask as unknown as HTMLDialogElement, io);
    a.line.textContent = "old";
    io.restore!();
    expect(a.ask.closes).toBe(1);
    expect(a.ask.open).toBe(false);
    expect(a.standing()).toBe(false);
    expect(a.line.textContent).toBe("");
    expect(a.ask.fire("cancel").defaultPrevented).toBe(false);
  });

  test("release with a reason writes it in the dialog's own line; release without one leaves the line (AC-3)", () => {
    const a = fakeAsk();
    standOpen(a.ask as unknown as HTMLDialogElement, restoring()).release("Not on the allowlist.");
    expect(a.line.textContent).toBe("Not on the allowlist.");
    expect(a.standing()).toBe(false);
    expect(a.ask.open).toBe(true);
    const b = fakeAsk();
    const hold = standOpen(b.ask as unknown as HTMLDialogElement, restoring());
    b.line.textContent = "kept";
    hold.release();
    expect(b.line.textContent).toBe("kept");
  });
});
