// The wait behind the Reopen and Close confirmation forms: a modal dialog
// opens on submit and stands until the queued job has settled.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { settled, submitProgress, type ProgressIo } from "../../../src/specs-client/progress-dialog/index.ts";
import { NEW_SPEC_FORM } from "../../../src/specs-client/state.ts";

const BACK = "/specs/aide/150-x";

type Listener = (e: { preventDefault(): void; defaultPrevented: boolean }) => void;

function fakeDialog(withShowModal = true) {
  const listeners: Record<string, Listener[]> = {};
  const dialog = {
    shows: 0,
    closes: 0,
    addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
    close() {
      dialog.closes += 1;
    },
    fire(type: string) {
      const e = { defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } };
      for (const fn of listeners[type] ?? []) fn(e);
      return e;
    },
    ...(withShowModal ? { showModal() { dialog.shows += 1; } } : {}),
  };
  return dialog;
}

function fakeForm(dialog: ReturnType<typeof fakeDialog>) {
  return {
    action: "http://dash.test/api/queue",
    id: "",
    dataset: { progress: BACK } as Record<string, string>,
    querySelector: (sel: string) => (sel.includes("data-progress-dialog") ? dialog : null),
    querySelectorAll: () => [],
    closest: () => null,
  } as unknown as HTMLFormElement;
}

interface Io extends ProgressIo {
  gone: string[];
  polls: number;
  restore?: () => void;
}

/** `answers` is what each poll of the job says, the last one repeated. */
function fakeIo(answers: { status?: number; job?: { state: string; landing?: boolean } }[]): Io {
  const io: Io = {
    gone: [],
    polls: 0,
    get: async () => ({ status: 200, ...answers[Math.min(io.polls++, answers.length - 1)]! }),
    sleep: async () => {},
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

describe("submitProgress", () => {
  test("opens the dialog once, posts for JSON, and goes to the list only when the job is done (AC-2)", async () => {
    const requests = stubPost(200, { ok: true, job: { id: "j1" } });
    const dialog = fakeDialog();
    const io = fakeIo([{ job: { state: "queued" } }, { job: { state: "running" } }, { job: { state: "done" } }]);
    const event = submit();
    await submitProgress(fakeForm(dialog), event, io);
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.shows).toBe(1);
    expect(requests[0]!.headers.accept).toBe("application/json");
    expect(io.polls).toBe(3);
    expect(io.gone).toEqual(["/"]);
    expect(dialog.closes).toBe(0);
  });

  test("a done job that is still landing keeps the dialog standing (AC-2)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const io = fakeIo([
      { job: { state: "done", landing: true } },
      { job: { state: "done", landing: true } },
      { job: { state: "done" } },
    ]);
    await submitProgress(fakeForm(fakeDialog()), submit(), io);
    expect(io.polls).toBe(3);
    expect(io.gone).toEqual(["/"]);
  });

  test("a post answered with no job id goes to the spec page (AC-2)", async () => {
    stubPost(200, { ok: true });
    const io = fakeIo([{ job: { state: "done" } }]);
    await submitProgress(fakeForm(fakeDialog()), submit(), io);
    expect(io.polls).toBe(0);
    expect(io.gone).toEqual([BACK]);
  });

  test("Escape is default-prevented, and a browser that closes the dialog anyway gets it stood up again (AC-2)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const dialog = fakeDialog();
    const io = fakeIo([{ job: { state: "running" } }]);
    io.sleep = async () => {
      expect(dialog.fire("cancel").defaultPrevented).toBe(true);
      dialog.fire("close");
      // Never settles on its own: end the wait from here.
      if (io.polls >= 2) io.get = async () => ({ status: 200, job: { state: "done" } });
    };
    await submitProgress(fakeForm(dialog), submit(), io);
    expect(dialog.shows).toBeGreaterThan(1);
  });

  test("a close after the wait is over is left alone (AC-2)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const dialog = fakeDialog();
    await submitProgress(fakeForm(dialog), submit(), fakeIo([{ job: { state: "done" } }]));
    const shown = dialog.shows;
    dialog.fire("close");
    expect(dialog.shows).toBe(shown);
  });

  test("a page restored from the back/forward cache closes the dialog (AC-2)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const dialog = fakeDialog();
    const io = fakeIo([{ job: { state: "done" } }]);
    await submitProgress(fakeForm(dialog), submit(), io);
    io.restore!();
    expect(dialog.closes).toBe(1);
  });

  test("a job that settles failed takes the page to the spec page, not the list (AC-4)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const io = fakeIo([{ job: { state: "running" } }, { job: { state: "failed" } }]);
    await submitProgress(fakeForm(fakeDialog()), submit(), io);
    expect(io.gone).toEqual([BACK]);
  });

  test("a refused post closes the dialog and goes to the spec page with the reason (AC-4)", async () => {
    stubPost(400, { error: "Only an archived spec can be reopened." });
    const dialog = fakeDialog();
    const io = fakeIo([{ job: { state: "done" } }]);
    await submitProgress(fakeForm(dialog), submit(), io);
    expect(dialog.closes).toBe(1);
    expect(io.gone).toEqual([`${BACK}?error=${encodeURIComponent("Only an archived spec can be reopened.")}`]);
  });

  test("a dialog with no showModal leaves the submit alone, so the form posts as it does today (AC-3)", async () => {
    const dialog = fakeDialog(false);
    const event = submit();
    const io = fakeIo([]);
    await submitProgress(fakeForm(dialog), event, io);
    expect(event.defaultPrevented).toBe(false);
    expect(io.gone).toEqual([]);
  });
});

/** The close ask: a dialog the posting form sits INSIDE, with a line for a refusal. */
function fakeAsk() {
  const base = fakeDialog();
  const attrs = new Set<string>();
  const line = { textContent: "" };
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
    querySelector: (sel: string) => (sel === ".refused" ? line : null),
  });
  const form = {
    action: "http://dash.test/api/queue",
    id: "closeask",
    dataset: { progress: BACK } as Record<string, string>,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: (sel: string) => (sel.includes("data-progress-dialog") ? ask : null),
  } as unknown as HTMLFormElement;
  return { ask, form, line, standing: () => attrs.has("data-standing") };
}

describe("submitProgress from inside the close ask (spec 525)", () => {
  test("the dialog is found from the form's ancestor and is not opened again when it is open (AC-5)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const a = fakeAsk();
    a.ask.open = true;
    await submitProgress(a.form, submit(), fakeIo([{ job: { state: "done" } }]));
    expect(a.ask.shows).toBe(0);
  });

  test("it stands while waiting and goes to the list when the job is done (AC-6)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const a = fakeAsk();
    const io = fakeIo([{ job: { state: "running" } }, { job: { state: "done" } }]);
    let standingWhileWaiting = false;
    const sleep = io.sleep;
    io.sleep = async (ms) => {
      standingWhileWaiting = a.standing();
      return sleep(ms);
    };
    await submitProgress(a.form, submit(), io);
    expect(standingWhileWaiting).toBe(true);
    expect(io.gone).toEqual(["/"]);
  });

  test("any other end takes the reader to the spec page (AC-6)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const io = fakeIo([{ job: { state: "failed" } }]);
    await submitProgress(fakeAsk().form, submit(), io);
    expect(io.gone).toEqual([BACK]);
  });

  test("a refusal is written in the box, which stays open, is not standing, and nothing navigates (AC-5)", async () => {
    stubPost(400, { error: "Give a reason." });
    const a = fakeAsk();
    const io = fakeIo([]);
    await submitProgress(a.form, submit(), io);
    expect(a.line.textContent).toBe("Give a reason.");
    expect(a.ask.closes).toBe(0);
    expect(a.standing()).toBe(false);
    expect(io.gone).toEqual([]);
  });

  test("Escape is prevented only while a job is waited for, and again after a second press (AC-5)", async () => {
    stubPost(400, { error: "no" });
    const a = fakeAsk();
    const io = fakeIo([]);
    await submitProgress(a.form, submit(), io);
    expect(a.ask.fire("cancel").defaultPrevented).toBe(false);
    stubPost(200, { ok: true, job: { id: "j1" } });
    let during: boolean | undefined;
    const io2 = fakeIo([{ job: { state: "running" } }, { job: { state: "done" } }]);
    io2.sleep = async () => {
      during = a.ask.fire("cancel").defaultPrevented;
    };
    await submitProgress(a.form, submit(), io2);
    expect(during).toBe(true);
  });

  test("a second press does not stack listeners: one cancel prevention per event, one stand-up per close (AC-5)", async () => {
    stubPost(400, { error: "no" });
    const a = fakeAsk();
    await submitProgress(a.form, submit(), fakeIo([]));
    await submitProgress(a.form, submit(), fakeIo([]));
    const shown = a.ask.shows;
    a.ask.fire("close");
    expect(a.ask.shows).toBe(shown);
  });

  test("a restore from the cache closes the box and clears the standing state and the line (AC-6)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const a = fakeAsk();
    a.line.textContent = "old";
    const io = fakeIo([{ job: { state: "done" } }]);
    await submitProgress(a.form, submit(), io);
    a.ask.setAttribute("data-standing");
    io.restore!();
    expect(a.ask.closes).toBe(1);
    expect(a.standing()).toBe(false);
    expect(a.line.textContent).toBe("");
  });
});

describe("settled", () => {
  test("gives up after the polls it was given and says so with undefined (AC-2)", async () => {
    const io = fakeIo([{ job: { state: "running" } }]);
    expect(await settled("j1", io, 3)).toBeUndefined();
    expect(io.polls).toBe(3);
  });

  test("a job the queue no longer remembers ends the wait (AC-2)", async () => {
    const io = fakeIo([{ status: 404 }]);
    expect(await settled("j1", io, 5)).toBeUndefined();
    expect(io.polls).toBe(1);
  });

  test("a failed poll is retried, not fatal (AC-2)", async () => {
    let calls = 0;
    const io = fakeIo([]);
    io.get = async () => {
      if (calls++ === 0) throw new Error("network");
      return { status: 200, job: { state: "done" } };
    };
    expect((await settled("j1", io, 5))?.state).toBe("done");
  });
});

describe("which forms the New-spec handler binds (AC-3)", () => {
  test("neither confirmation form matches, and the New-spec form still does", async () => {
    const win = new Window();
    win.document.write(
      `<form id="new" class="newspecform"></form>` +
        `<form id="add" class="newspecform addprojectform"></form>` +
        `<form id="settings" class="newspecform projectsettingsform"></form>` +
        `<form id="reopen" class="newspecform" data-progress="${BACK}"></form>` +
        `<form id="close" class="newspecform specform" data-progress="${BACK}"></form>`,
    );
    const ids = [...win.document.querySelectorAll(NEW_SPEC_FORM)].map((f) => f.id);
    await win.happyDOM.close();
    expect(ids).toEqual(["new"]);
  });
});
