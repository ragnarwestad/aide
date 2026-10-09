// The hold every progress dialog is kept open by while its job runs, and
// the wait behind the Reopen and Close dialogs: the dialog stands on OK
// until the queued job has settled.

import { afterEach, describe, expect, test } from "bun:test";
import { FAILED_STAYS_MS, isStanding, SETTLE_EVERY_MS, settled, standOpen, submitProgress, type ProgressIo } from "../../../src/specs-client/progress-dialog";

const BACK = "/specs/aide/150-x";

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
  polls: number;
  /** The address each poll asked. */
  asked: string[];
  restore?: () => void;
}

type Answer = Awaited<ReturnType<ProgressIo["get"]>>;

/** `answers` is what each poll of the job says, the last one repeated. */
function fakeIo(answers: Partial<Answer>[]): Io {
  const io: Io = {
    gone: [],
    polls: 0,
    asked: [],
    get: async (url) => {
      io.asked.push(url);
      return { status: 200, ...answers[Math.min(io.polls++, answers.length - 1)]! };
    },
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

/** The ask: a dialog the posting form sits INSIDE, with a line for a refusal. */
function fakeAsk() {
  const base = fakeDialog();
  const attrs = new Set<string>();
  const refused = { textContent: "" };
  /** The step list, with the lines a job before this one left in it: a planned line, done, and one its log added. */
  const word = { textContent: "done" };
  const line = (added: boolean) => {
    const li = {
      dataset: { state: "done" } as Record<string, string>,
      hasAttribute: (name: string) => added && name === "data-added",
      querySelector: () => word,
      remove: () => void (list.children = list.children.filter((other) => other !== li)),
    };
    return li;
  };
  const list = {
    children: [] as ReturnType<typeof line>[],
    dataset: { waiting: "waiting" } as Record<string, string>,
    /** What each line's state is now, in order. */
    states: () => list.children.map((li) => li.dataset.state),
  };
  const leave = () => {
    list.children = [line(false), line(true)];
  };
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
    querySelector: (sel: string) => (sel === ".refused" ? refused : sel === "ol.progresssteps" ? list : null),
  });
  const form = {
    action: "http://dash.test/api/queue",
    id: "closeask",
    dataset: { progress: BACK } as Record<string, string>,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: (sel: string) => (sel.includes("data-progress-dialog") ? ask : null),
  } as unknown as HTMLFormElement;
  return { ask, form, line: refused, list, leave, standing: () => attrs.has("data-standing") };
}

describe("submitProgress from inside the ask", () => {
  test("posts for JSON, stands while it polls until the job settles, and goes to the list only then (AC-3)", async () => {
    const requests = stubPost(200, { ok: true, job: { id: "j1" } });
    const a = fakeAsk();
    const io = fakeIo([{ job: { state: "queued" } }, { job: { state: "running" } }, { job: { state: "done" } }]);
    let standingWhileWaiting = false;
    const sleep = io.sleep;
    io.sleep = async (ms) => {
      standingWhileWaiting = a.standing();
      return sleep(ms);
    };
    const event = submit();
    await submitProgress(a.form, event, io);
    expect(event.defaultPrevented).toBe(true);
    expect(a.ask.shows).toBe(1);
    expect(requests[0]!.headers.accept).toBe("application/json");
    expect(standingWhileWaiting).toBe(true);
    expect(io.polls).toBe(3);
    expect(io.gone).toEqual(["/"]);
    expect(a.ask.closes).toBe(0);
  });

  test("a done job that is still landing keeps the dialog standing", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const io = fakeIo([
      { job: { state: "done", landing: true } },
      { job: { state: "done", landing: true } },
      { job: { state: "done" } },
    ]);
    await submitProgress(fakeAsk().form, submit(), io);
    expect(io.polls).toBe(3);
    expect(io.gone).toEqual(["/"]);
  });

  test("a post answered with no job id goes to data-progress", async () => {
    stubPost(200, { ok: true });
    const io = fakeIo([{ job: { state: "done" } }]);
    await submitProgress(fakeAsk().form, submit(), io);
    expect(io.polls).toBe(0);
    expect(io.gone).toEqual([BACK]);
  });

  test("a done job goes to data-progress-done when the form carries it, and to / when not (AC-4)", async () => {
    const LIST = "/?state=archived";
    stubPost(200, { ok: true, job: { id: "j1" } });
    const listed = fakeAsk();
    listed.form.dataset.progressDone = LIST;
    const io = fakeIo([{ job: { state: "done" } }]);
    await submitProgress(listed.form, submit(), io);
    expect(io.gone).toEqual([LIST]);
    const bare = fakeIo([{ job: { state: "done" } }]);
    await submitProgress(fakeAsk().form, submit(), bare);
    expect(bare.gone).toEqual(["/"]);
  });

  test("any other end goes to data-progress, data-progress-done or not (AC-4)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const listed = fakeAsk();
    listed.form.dataset.progressDone = "/?state=archived";
    const io = fakeIo([{ job: { state: "failed" } }]);
    await submitProgress(listed.form, submit(), io);
    expect(io.gone).toEqual([BACK]);
    const bare = fakeIo([{ job: { state: "failed" } }]);
    await submitProgress(fakeAsk().form, submit(), bare);
    expect(bare.gone).toEqual([BACK]);
  });

  test("a refusal is written in the box, which stays open, is not standing, and nothing navigates (AC-3)", async () => {
    stubPost(400, { error: "Give a reason." });
    const a = fakeAsk();
    const io = fakeIo([]);
    await submitProgress(a.form, submit(), io);
    expect(a.line.textContent).toBe("Give a reason.");
    expect(a.ask.closes).toBe(0);
    expect(a.standing()).toBe(false);
    expect(io.gone).toEqual([]);
  });

  test("each poll asks for the job's marks (AC-1)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const io = fakeIo([{ job: { state: "running" } }, { job: { state: "done" } }]);
    await submitProgress(fakeAsk().form, submit(), io);
    expect(io.asked).toEqual(["/api/queue/j1?marks=1", "/api/queue/j1?marks=1"]);
  });

  for (const end of ["failed", "stopped", "cancelled", "interrupted"]) {
    test(`a job that ends ${end} writes its reason while the dialog stands, pauses, and only then goes back (AC-4)`, async () => {
      stubPost(200, { ok: true, job: { id: "j1" } });
      const a = fakeAsk();
      const io = fakeIo([{ job: { state: "running" } }, { job: { state: end }, marks: [], reason: "the close is not finished" }]);
      const seen: string[] = [];
      io.sleep = async (ms) => void seen.push(`sleep ${ms} standing=${a.standing()} line=${a.line.textContent}`);
      io.go = (url) => void seen.push(`go ${url}`);
      await submitProgress(a.form, submit(), io);
      expect(seen).toEqual([
        `sleep ${SETTLE_EVERY_MS} standing=true line=`,
        `sleep ${FAILED_STAYS_MS} standing=true line=The close is not finished`,
        `go ${BACK}`,
      ]);
    });
  }

  test("a done job whose merge stopped writes its reason while the dialog stands, pauses, then goes where a done job goes (AC-4)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const a = fakeAsk();
    const io = fakeIo([{ job: { state: "done" }, marks: [], reason: "nothing was merged" }]);
    const seen: string[] = [];
    io.sleep = async (ms) => void seen.push(`sleep ${ms} standing=${a.standing()} line=${a.line.textContent}`);
    io.go = (url) => void seen.push(`go ${url}`);
    await submitProgress(a.form, submit(), io);
    expect(seen).toEqual([`sleep ${FAILED_STAYS_MS} standing=true line=Nothing was merged`, "go /"]);
  });

  test("a done job goes at once, and so does a wait that gives up (AC-5)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    for (const answers of [[{ job: { state: "done" } }], [{ status: 404 }]]) {
      const io = fakeIo(answers);
      const slept: number[] = [];
      io.sleep = async (ms) => void slept.push(ms);
      await submitProgress(fakeAsk().form, submit(), io);
      expect(slept).toEqual([]);
      expect(io.gone).toHaveLength(1);
    }
    const running = fakeIo([{ job: { state: "running" } }]);
    const slept: number[] = [];
    running.sleep = async (ms) => void slept.push(ms);
    await submitProgress(fakeAsk().form, submit(), running);
    expect(slept).not.toContain(FAILED_STAYS_MS);
    expect(running.gone).toEqual([BACK]);
  });

  test("a second press resets the step list before its first poll (AC-3)", async () => {
    stubPost(200, { ok: true, job: { id: "j1" } });
    const a = fakeAsk();
    await submitProgress(a.form, submit(), fakeIo([{ job: { state: "done" } }]));
    a.leave();
    let atFirstPoll: string[] | undefined;
    const io = fakeIo([{ job: { state: "done" } }]);
    const get = io.get;
    io.get = async (url) => {
      atFirstPoll ??= a.list.states();
      return get(url);
    };
    await submitProgress(a.form, submit(), io);
    expect(atFirstPoll).toEqual(["waiting"]);
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

describe("settled", () => {
  test("gives up after the polls it was given and says so with undefined", async () => {
    const io = fakeIo([{ job: { state: "running" } }]);
    expect(await settled("j1", io, 3)).toBeUndefined();
    expect(io.polls).toBe(3);
  });

  test("a job the queue no longer remembers ends the wait", async () => {
    const io = fakeIo([{ status: 404 }]);
    expect(await settled("j1", io, 5)).toBeUndefined();
    expect(io.polls).toBe(1);
  });

  test("a failed poll is retried, not fatal", async () => {
    let calls = 0;
    const io = fakeIo([]);
    io.get = async () => {
      if (calls++ === 0) throw new Error("network");
      return { status: 200, job: { state: "done" } };
    };
    expect((await settled("j1", io, 5))?.state).toBe("done");
  });
});
