// The /schedule page's own client wiring (spec 276): the Enabled
// toggle, Run-now, and the debounced cron-next preview. Minimal
// hand-built fakes rather than the queue-list's own bundle-and-fake-
// document harness (`fixtures.ts`): none of these controls live inside
// `#jobrows`, so this page has no row-swap machinery to exercise.
// Acceptance criteria 14, 15, 16.
import { describe, expect, test } from "bun:test";
import {
  bindScheduleDelete, postScheduleEnabled, postScheduleRun, runCronPreview, scheduleCronPreview,
} from "../../src/queue-client/schedule-actions.ts";

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

describe("postScheduleEnabled (acceptance criterion 14)", () => {
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

function fakeStateCell(): HTMLElement {
  return { textContent: "never run" } as unknown as HTMLElement;
}

function fakeRunForm(action: string, stateCell: HTMLElement): HTMLFormElement {
  const button = { disabled: false };
  const tr = { querySelector: () => stateCell };
  return {
    action,
    querySelector: () => button,
    closest: () => tr,
  } as unknown as HTMLFormElement;
}

describe("postScheduleRun (acceptance criterion 15)", () => {
  test("posts to the form's own action and writes the new job's state into the row, without navigating", async () => {
    const stateCell = fakeStateCell();
    const form = fakeRunForm("/api/queue/schedule/aide/nightly/run", stateCell);
    const fetchImpl = fakeFetch(() => ({ ok: true, body: { ok: true, job: { state: "queued" } } }));
    await postScheduleRun(form, fetchImpl);
    expect(stateCell.textContent).toBe("queued");
  });

  test("a refusal leaves the row's state untouched", async () => {
    const stateCell = fakeStateCell();
    const form = fakeRunForm("/api/queue/schedule/aide/nightly/run", stateCell);
    const fetchImpl = fakeFetch(() => ({ ok: false, body: { error: "refused" } }));
    await postScheduleRun(form, fetchImpl);
    expect(stateCell.textContent).toBe("never run");
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

describe("runCronPreview / scheduleCronPreview (acceptance criterion 16)", () => {
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

// The row's Delete: the click opens that row's own confirmation over
// the list instead of following the link to the page it points at. The
// link keeps that href, so a browser where this never runs (no script,
// no `<dialog>`) still reaches the confirmation the way it always has.
describe("bindScheduleDelete (2026-08-31)", () => {
  function fakeRow(o: { hasDialog?: boolean; modal?: boolean } = {}) {
    const opened: string[] = [];
    const dialog = o.modal === false ? {} : { showModal: () => void opened.push("open") };
    const cell = { querySelector: (sel: string) => (sel === "dialog" && o.hasDialog !== false ? dialog : null) };
    const listeners: ((e: Event) => void)[] = [];
    const link = {
      parentElement: cell,
      addEventListener: (_name: string, fn: (e: Event) => void) => void listeners.push(fn),
    };
    const click = () => {
      let prevented = false;
      const event = { preventDefault: () => void (prevented = true) } as unknown as Event;
      for (const fn of listeners) fn(event);
      return prevented;
    };
    return { link, click, opened, bound: () => listeners.length };
  }

  test("the click opens the dialog beside it and does not follow the link", () => {
    const row = fakeRow();
    bindScheduleDelete(row.link as unknown as HTMLAnchorElement);
    expect(row.click()).toBe(true);
    expect(row.opened).toEqual(["open"]);
  });

  test("a link with no dialog beside it is left alone — the href is the whole flow there", () => {
    const row = fakeRow({ hasDialog: false });
    bindScheduleDelete(row.link as unknown as HTMLAnchorElement);
    expect(row.bound()).toBe(0);
  });

  test("a browser without showModal is left alone too, rather than swallowing the click", () => {
    const row = fakeRow({ modal: false });
    bindScheduleDelete(row.link as unknown as HTMLAnchorElement);
    expect(row.bound()).toBe(0);
  });
});
