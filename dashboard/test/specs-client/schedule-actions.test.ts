// The /schedule page's own client wiring: the Enabled
// toggle, Run-now, and the debounced cron-next preview. Minimal
// hand-built fakes rather than the specs-list's own bundle-and-fake-
// document harness (`fixtures.ts`): none of these controls live inside
// `#jobrows`, so this page has no row-swap machinery to exercise.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  followScheduleRow, leaveAfterSave, postScheduleEnabled, postScheduleRun, reconcileScheduleRuns, runCronPreview, scheduleCronPreview,
  submitScheduleForm,
} from "../../src/specs-client/schedule-actions.ts";

function fakeCheckbox(o: { checked: boolean; postTo: string }): HTMLInputElement {
  const box = {
    checked: o.checked,
    disabled: false,
    getAttribute: (name: string) => (name === "data-post-to" ? o.postTo : null),
  };
  return box as unknown as HTMLInputElement;
}

function fakeFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; body?: unknown }): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const { ok, body } = handler(url, init);
    return { ok, json: async () => body } as Response;
  }) as typeof fetch;
}

describe("postScheduleEnabled", () => {
  test("disables the box, posts the wanted value, and leaves it checked on success", async () => {
    const box = fakeCheckbox({ checked: true, postTo: "/api/queue/schedule/aide/nightly/enabled" });
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = fakeFetch((url, init) => {
      calls.push({ url, body: String(init?.body ?? "") });
      return { ok: true, body: { ok: true, enabled: true } };
    });
    await postScheduleEnabled(box, fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/queue/schedule/aide/nightly/enabled");
    expect(JSON.parse(calls[0]!.body)).toEqual({ enabled: "1" });
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
  });

  test("puts the tick back on a refusal", async () => {
    const box = fakeCheckbox({ checked: false, postTo: "/api/queue/schedule/aide/nightly/enabled" });
    const fetchImpl = fakeFetch(() => ({ ok: false, body: { error: "refused" } }));
    await postScheduleEnabled(box, fetchImpl);
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
  });

  test("the box is disabled while the request is out", async () => {
    let sawDisabled = false;
    const box = fakeCheckbox({ checked: true, postTo: "/x" });
    const fetchImpl = (async () => {
      sawDisabled = box.disabled;
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }) as unknown as typeof fetch;
    await postScheduleEnabled(box, fetchImpl);
    expect(sawDisabled).toBe(true);
  });
});

function fakeSlot(): HTMLElement {
  return { textContent: "" } as unknown as HTMLElement;
}

/** Answers `closest("main")` by selector, and `querySelector` by what is asked for. */
function fakeRunForm(action: string, slot: HTMLElement = fakeSlot()): HTMLFormElement {
  const button = { disabled: false, textContent: "Run now", dataset: {} as Record<string, string> };
  const main = { querySelector: (sel: string) => (sel === ".refused" ? slot : null) };
  return {
    action,
    dataset: { idle: "Run now", queued: "Queued", running: "Running" },
    querySelector: () => button,
    closest: (sel: string) => (sel === "main" ? main : null),
  } as unknown as HTMLFormElement;
}

describe("postScheduleRun", () => {
  test("a refusal leaves its reason in the page's slot", async () => {
    const slot = fakeSlot();
    const form = fakeRunForm("/api/queue/schedule/aide/nightly/run", slot);
    const fetchImpl = fakeFetch(() => ({ ok: false, body: { error: "refused" } }));
    await postScheduleRun(form, fetchImpl);
    expect(slot.textContent).toBe("Problem: Refused");
  });

  test("a later accepted press empties the slot", async () => {
    const slot = fakeSlot();
    const form = fakeRunForm("/api/queue/schedule/aide/nightly/run", slot);
    await postScheduleRun(form, fakeFetch(() => ({ ok: false, body: { error: "refused" } })));
    await postScheduleRun(form, fakeFetch(() => ({ ok: true, body: { ok: true, job: { state: "queued" } } })));
    expect(slot.textContent).toBe("");
  });

  test("a request that fails outright says so in the slot", async () => {
    const slot = fakeSlot();
    const form = fakeRunForm("/x", slot);
    await postScheduleRun(form, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(slot.textContent).toBe("Problem: The request failed");
  });

  test("an older queued POST answer does not replace a newer running queue state (AC-2)", async () => {
    const form = fakeRunForm("/api/queue/schedule/aide/nightly/run");
    const button = form.querySelector("button") as HTMLButtonElement;
    let answer: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { answer = resolve; });
    const posted = postScheduleRun(form, (async () => {
      await held;
      return { ok: true, json: async () => ({ ok: true, job: { state: "queued" } }) } as Response;
    }) as unknown as typeof fetch);
    button.dataset.scheduleState = "running";
    button.textContent = "Running";
    answer!();
    await posted;
    expect([button.disabled, button.textContent, button.dataset.scheduleState]).toEqual([true, "Running", "running"]);
  });
});

describe("reconcileScheduleRuns", () => {
  function runPage(): { doc: Document; button: HTMLButtonElement; next: HTMLElement } {
    const window = new Window();
    window.document.body.innerHTML = `<table><tr><td class="next">2030-01-02</td><td><form class="schedulerun" data-project="aide" data-entry="nightly" data-idle="Run now" data-queued="Queued" data-running="Running"><button>Run now</button></form></td></tr></table>`;
    return {
      doc: window.document as unknown as Document,
      button: window.document.querySelector("button") as unknown as HTMLButtonElement,
      next: window.document.querySelector(".next") as unknown as HTMLElement,
    };
  }

  test("shows exact queued and running schedule jobs without changing Next run (AC-1, AC-2, AC-4)", async () => {
    const page = runPage();
    let state = "queued";
    const fetchImpl = fakeFetch(() => ({ ok: true, body: { jobs: [{ project: "aide", specFolder: "schedule-nightly", steps: ["schedule"], state }] } }));
    await reconcileScheduleRuns(page.doc, fetchImpl);
    expect([page.button.disabled, page.button.textContent, page.next.textContent]).toEqual([true, "Queued", "2030-01-02"]);
    state = "running";
    await reconcileScheduleRuns(page.doc, fetchImpl);
    expect([page.button.disabled, page.button.textContent, page.next.textContent]).toEqual([true, "Running", "2030-01-02"]);
  });

  test("restores Run now when a job ends and ignores other schedule jobs (AC-3)", async () => {
    const page = runPage();
    page.button.disabled = true;
    page.button.textContent = "Running";
    await reconcileScheduleRuns(page.doc, fakeFetch(() => ({
      ok: true,
      body: { jobs: [
        { project: "other", specFolder: "schedule-nightly", steps: ["schedule"], state: "running" },
        { project: "aide", specFolder: "schedule-nightly", steps: ["schedule"], state: "done" },
      ] },
    })));
    expect([page.button.disabled, page.button.textContent]).toEqual([false, "Run now"]);
  });

  test("leaves the last known state alone when the queue cannot be read (AC-3)", async () => {
    const page = runPage();
    page.button.disabled = true;
    page.button.textContent = "Running";
    await reconcileScheduleRuns(page.doc, fakeFetch(() => ({ ok: false })));
    expect([page.button.disabled, page.button.textContent]).toEqual([true, "Running"]);
  });
});

function fakeCronInput(value: string): HTMLInputElement {
  return { value } as unknown as HTMLInputElement;
}

function fakeTarget(): HTMLElement {
  const classes = new Set<string>();
  return {
    textContent: "",
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) },
  } as unknown as HTMLElement;
}

describe("runCronPreview / scheduleCronPreview", () => {
  test("a valid cron writes the computed Next-run line", async () => {
    const input = fakeCronInput("0 3 * * *");
    const target = fakeTarget();
    const fetchImpl = fakeFetch(() => ({ ok: true, body: { next: "2026-08-30T03:00:00.000Z" } }));
    await runCronPreview(input, target, fetchImpl);
    expect(target.textContent).toBe("Next run: 2026-08-30T03:00:00.000Z");
    expect((target.classList as unknown as { contains: (c: string) => boolean }).contains("err")).toBe(false);
  });

  test("an invalid cron writes the server's error inline instead of a timestamp", async () => {
    const input = fakeCronInput("not-a-cron");
    const target = fakeTarget();
    const fetchImpl = fakeFetch(() => ({ ok: false, body: { error: '"not-a-cron" is not a valid cron expression' } }));
    await runCronPreview(input, target, fetchImpl);
    expect(target.textContent).toBe('"not-a-cron" is not a valid cron expression');
    expect((target.classList as unknown as { contains: (c: string) => boolean }).contains("err")).toBe(true);
  });

  test("an invalid cron writes the field's own sentence when the field carries one (AC-2)", async () => {
    const target = Object.assign(fakeTarget(), { dataset: { invalid: "ikke et gyldig cron-uttrykk" } });
    const fetchImpl = fakeFetch(() => ({ ok: false, body: { error: '"x" is not a valid cron expression' } }));
    await runCronPreview(fakeCronInput("x"), target, fetchImpl);
    expect(target.textContent).toBe("ikke et gyldig cron-uttrykk");
  });

  test("an empty field clears the line without asking the server", async () => {
    const input = fakeCronInput("");
    const target = fakeTarget();
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    await runCronPreview(input, target, fetchImpl);
    expect(called).toBe(false);
    expect(target.textContent).toBe("");
  });

  test("rapid successive calls only fetch once, after the debounce settles", async () => {
    const input = fakeCronInput("0 3 * * *");
    const target = fakeTarget();
    let calls = 0;
    const fetchImpl = fakeFetch(() => {
      calls += 1;
      return { ok: true, body: { next: "2026-08-30T03:00:00.000Z" } };
    });
    scheduleCronPreview(input, target, fetchImpl, 10);
    scheduleCronPreview(input, target, fetchImpl, 10);
    scheduleCronPreview(input, target, fetchImpl, 10);
    expect(calls).toBe(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toBe(1);
    expect(target.textContent).toBe("Next run: 2026-08-30T03:00:00.000Z");
  });
});

// Save and Create on the page that makes or changes an entry: the
// globals `postForm` reads are put in place for the one press and taken
// back after it.
describe("submitScheduleForm", () => {
  async function press(answer: { ok: boolean; body: unknown }) {
    const slot = { textContent: "" };
    const button = { disabled: false, textContent: "Save", title: "", dataset: {}, classList: { contains: () => false, add() {}, remove() {} }, isConnected: true };
    const form = {
      id: "schedule-form",
      action: "http://dash.test/api/queue/schedule/aide/nightly",
      dataset: {},
      closest: () => null,
      querySelectorAll: () => [button],
      querySelector: (sel: string) => (sel === ".refused" ? slot : null),
    };
    const saved = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch, FormData: globalThis.FormData };
    const went: string[] = [];
    const loc = { href: "http://dash.test/schedule/aide/nightly?tab=settings&edit=1", pathname: "/schedule/aide/nightly", search: "?tab=settings&edit=1" };
    Object.assign(globalThis, {
      document: { querySelectorAll: () => [] },
      location: loc,
      fetch: fakeFetch(() => answer),
      FormData: class { forEach(fn: (v: string, k: string) => void) { fn("nightly", "name"); } },
    });
    try {
      await submitScheduleForm(form as unknown as HTMLFormElement, { defaultPrevented: false, preventDefault() {} } as Event, (h) => went.push(h));
    } finally {
      Object.assign(globalThis, saved);
    }
    return { slot, went };
  }

  test("a save goes where the server says: the page the form was opened from", async () => {
    const { went, slot } = await press({ ok: true, body: { ok: true, location: "/projects/aide?tab=schedule" } });
    expect(went).toEqual(["/projects/aide?tab=schedule"]);
    expect(slot.textContent).toBe("");
  });

  test("a refusal is written into the form's error line, and the page stays", async () => {
    const { went, slot } = await press({ ok: false, body: { error: "a job named nightly already exists" } });
    expect(slot.textContent).toContain("A job named nightly already exists");
    expect(went).toEqual([]);
  });
});

// Where a save goes on to: back onto the entry's own page as an ordinary
// load, so that page keeps its "← Back"; anywhere else without a Referer.
describe("leaveAfterSave", () => {
  const here = { href: "http://dash.test/schedule/aide/nightly?tab=settings&edit=1", host: "dash.test", pathname: "/schedule/aide/nightly" };

  function leave(href: string) {
    const way: string[] = [];
    leaveAfterSave(href, here, { load: (to) => way.push(`load ${to}`), leave: (to) => way.push(`leave ${to}`) });
    return way;
  }

  test("an answer on the page the form is on loads it with the page as Referer", () => {
    expect(leave("/schedule/aide/nightly?tab=settings")).toEqual(["load /schedule/aide/nightly?tab=settings"]);
  });

  test("an answer on another path leaves without a Referer", () => {
    expect(leave("/schedule/aide/weekly?tab=settings")).toEqual(["leave /schedule/aide/weekly?tab=settings"]);
    expect(leave("/projects/aide?tab=schedule")).toEqual(["leave /projects/aide?tab=schedule"]);
  });
});

describe("followScheduleRow", () => {
  /** A click landing on an element inside a row whose target is `/x`;
   *  `onControl` says whether that element sits in one of the row's controls. */
  const click = (onControl: boolean, extra: Partial<MouseEvent> = {}) => {
    const row = { getAttribute: (n: string) => (n === "data-row-href" ? "/x" : null) };
    const target = { closest: (sel: string) => (sel.startsWith("tr[") ? row : onControl ? {} : null) };
    return { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target, ...extra } as unknown as MouseEvent;
  };

  test("a click on the row itself opens what the row links to", () => {
    const went: string[] = [];
    expect(followScheduleRow(click(false), (h) => went.push(h))).toBe("/x");
    expect(went).toEqual(["/x"]);
  });

  test("a click on one of the row's controls, or with a modifier key, is left to the browser", () => {
    const went: string[] = [];
    expect(followScheduleRow(click(true), (h) => went.push(h))).toBeNull();
    expect(followScheduleRow(click(false, { metaKey: true }), (h) => went.push(h))).toBeNull();
    expect(went).toEqual([]);
  });
});
