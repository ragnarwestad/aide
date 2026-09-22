// The Test servers list's own Stop button (spec 529): removing the row
// in place instead of navigating is what keeps "← Back" pointed at
// whatever page the list itself was opened from. Minimal hand-built
// fakes, the same shape `deploy-wait.test.ts` uses for `submitDeploy` —
// `submitTestServerStop` is a plain export, not part of the bundled
// entry point, so there is no need for the full bundle-and-fake-document
// harness `fixtures.ts` builds for `#jobrows`.

import { describe, expect, test } from "bun:test";
import { ACTIONS } from "../../../src/specs-client/press.ts";
import { submitTestServerStop } from "../../../src/specs-client/forms.ts";

function fakeForm(action: string) {
  const refusedSpan: { textContent: string } = { textContent: "" };
  const button = {
    tagName: "BUTTON",
    classList: { contains: () => false, add(): void {}, remove(): void {} },
    textContent: "Stop",
    title: "",
    disabled: false,
    isConnected: true,
    insertAdjacentHTML(): void {},
  };
  let removed = false;
  const tr = {
    remove: () => {
      removed = true;
      button.isConnected = false;
    },
  };
  const form = {
    action,
    id: "",
    dataset: {} as Record<string, string>,
    querySelector: (sel: string) => (sel === ".refused" ? refusedSpan : null),
    querySelectorAll: (sel: string) => (sel === "button" ? [button] : []),
    // A plain `<tr>`, not `tr.spechead` — the Test servers list has no
    // spec row, so `rowControls()` falls back to the form's own button
    // (`press.ts`'s `rowControls`, already exercised for this shape).
    closest: (sel: string) => (sel === "tr.spechead" ? null : sel === "tr" ? tr : null),
  };
  return { form, refusedSpan, removed: () => removed };
}

function fakeEvent(form: unknown) {
  let prevented = false;
  const event = {
    target: { closest: (sel: string) => (sel === ACTIONS ? form : null) },
    defaultPrevented: false,
    preventDefault: () => {
      prevented = true;
    },
  };
  return { event: event as unknown as Event, prevented: () => prevented };
}

function stubGlobals(reply: { ok: boolean; body: unknown }) {
  const realFetch = globalThis.fetch;
  const realFormData = globalThis.FormData;
  const realLocation = (globalThis as { location?: unknown }).location;
  let reloaded = false;
  (globalThis as unknown as { FormData: unknown }).FormData = class {
    constructor(_form: unknown) {}
    forEach(): void {}
  };
  (globalThis as unknown as { location: unknown }).location = {
    href: "http://dash.test/test-servers",
    pathname: "/test-servers",
    reload: () => {
      reloaded = true;
    },
  };
  (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
    ok: reply.ok,
    json: async () => reply.body,
  });
  return {
    reloaded: () => reloaded,
    restore: () => {
      globalThis.fetch = realFetch;
      globalThis.FormData = realFormData;
      (globalThis as { location?: unknown }).location = realLocation;
    },
  };
}

describe("submitTestServerStop (spec 529)", () => {
  test("a successful stop removes the row and never navigates (AC-1, AC-2)", async () => {
    const { form, removed } = fakeForm("http://dash.test/api/queue/projects/aide/test-server/stop");
    const { event, prevented } = fakeEvent(form);
    const stub = stubGlobals({ ok: true, body: { ok: true } });
    try {
      await submitTestServerStop(event);
      expect(removed()).toBe(true);
      expect(prevented()).toBe(true);
      expect(stub.reloaded()).toBe(false);
    } finally {
      stub.restore();
    }
  });

  test("a refused stop writes why into the row's own slot and leaves the row in place (AC-3)", async () => {
    const { form, refusedSpan, removed } = fakeForm("http://dash.test/api/queue/projects/aide/test-server/stop");
    const { event } = fakeEvent(form);
    const stub = stubGlobals({ ok: true, body: { ok: false, error: "no such test server" } });
    try {
      await submitTestServerStop(event);
      expect(refusedSpan.textContent).toBe("no such test server");
      expect(removed()).toBe(false);
    } finally {
      stub.restore();
    }
  });

  test("a form that already had its submit prevented is left alone", async () => {
    const { form, removed } = fakeForm("http://dash.test/api/queue/projects/aide/test-server/stop");
    const event = {
      target: { closest: (sel: string) => (sel === ACTIONS ? form : null) },
      defaultPrevented: true,
      preventDefault: () => {
        throw new Error("must not be called");
      },
    } as unknown as Event;
    await submitTestServerStop(event);
    expect(removed()).toBe(false);
  });
});
