// The /schedule page's own client wiring (spec 276): the Enabled
// toggle, Run-now, and the debounced cron-next preview. Minimal
// hand-built fakes rather than the specs-list's own bundle-and-fake-
// document harness (`fixtures.ts`): none of these controls live inside
// `#jobrows`, so this page has no row-swap machinery to exercise.
// Acceptance criteria 14, 15, 16.
import { describe, expect, test } from "bun:test";
import {
  postScheduleEnabled, postScheduleRun, runCronPreview, scheduleCronPreview,
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

function fakeSlot(): HTMLElement {
  return { textContent: "", className: "refused" } as unknown as HTMLElement;
}

/** Answers `closest("tr")` and `closest("main")` by selector, and `querySelector` by what is asked for. */
function fakeRunForm(action: string, stateCell: HTMLElement, slot: HTMLElement = fakeSlot()): HTMLFormElement {
  const button = { disabled: false };
  const tr = { querySelector: (sel: string) => (sel === "[data-schedule-state]" ? stateCell : null) };
  const main = { querySelector: (sel: string) => (sel === ".refused" ? slot : null) };
  return {
    action,
    querySelector: () => button,
    closest: (sel: string) => (sel === "tr" ? tr : sel === "main" ? main : null),
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

  test("a refusal leaves the row's state untouched and its reason in the page's slot (spec 494)", async () => {
    const stateCell = fakeStateCell();
    const slot = fakeSlot();
    const form = fakeRunForm("/api/queue/schedule/aide/nightly/run", stateCell, slot);
    const fetchImpl = fakeFetch(() => ({ ok: false, body: { error: "refused" } }));
    await postScheduleRun(form, fetchImpl);
    expect(stateCell.textContent).toBe("never run");
    expect(slot.textContent).toBe("refused");
    expect(slot.className).toBe("refused rowmsg failed");
  });

  test("a later accepted press empties the slot (spec 494)", async () => {
    const stateCell = fakeStateCell();
    const slot = fakeSlot();
    const form = fakeRunForm("/api/queue/schedule/aide/nightly/run", stateCell, slot);
    await postScheduleRun(form, fakeFetch(() => ({ ok: false, body: { error: "refused" } })));
    await postScheduleRun(form, fakeFetch(() => ({ ok: true, body: { ok: true, job: { state: "queued" } } })));
    expect(slot.textContent).toBe("");
    expect(slot.className).toBe("refused");
    expect(stateCell.textContent).toBe("queued");
  });

  test("a request that fails outright says so in the slot (spec 494)", async () => {
    const slot = fakeSlot();
    const form = fakeRunForm("/x", fakeStateCell(), slot);
    await postScheduleRun(form, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(slot.textContent).toBe("the request failed");
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
