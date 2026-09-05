// The Deploy button's wait for the restarted service (forms.ts,
// `waitForServer`): probes the page until it answers again, sleeping
// between probes, and never mistakes a thrown fetch for an answer.

import { describe, expect, test } from "bun:test";
import { submitDeploy, waitForServer } from "../../src/queue-client/forms.ts";

describe("waitForServer", () => {
  test("keeps probing through refused connections until the page answers, then resolves", async () => {
    const answers: (() => Promise<{ ok: boolean }>)[] = [
      () => Promise.reject(new Error("connection refused")),
      () => Promise.resolve({ ok: false }),
      () => Promise.resolve({ ok: true }),
    ];
    let probes = 0;
    const slept: number[] = [];
    const back = await waitForServer(
      () => answers[Math.min(probes++, answers.length - 1)]!(),
      async (ms) => {
        slept.push(ms);
      },
    );
    expect(back).toBe(true);
    expect(probes).toBe(3);
    // The initial wait for the kickstart, then one sleep per failed probe.
    expect(slept).toEqual([2000, 1500, 1500]);
  });

  test("gives up after the bound, and says so", async () => {
    const back = await waitForServer(() => Promise.reject(new Error("down")), async () => {}, 3);
    expect(back).toBe(false);
  });
});

// Spec 385 (REQ-1, REQ-2, REQ-5): the Deploy button's own note, drawn
// from the press's own answer alone — a minimal fake form, just the
// handful of DOM methods `postForm`/`submitDeploy` actually call, in
// place of a real `HTMLFormElement`.
describe("submitDeploy (spec 385)", () => {
  function fakeForm() {
    const refusedSpan: { textContent: string } = { textContent: "" };
    const button = {
      tagName: "BUTTON",
      classList: { contains: () => false, add(): void {}, remove(): void {} },
      textContent: "Deploy",
      title: "",
    };
    const form = {
      action: "http://dash.test/api/queue/projects/aide/deploy",
      id: "",
      querySelector: (sel: string) => (sel === ".refused" ? refusedSpan : null),
      querySelectorAll: (sel: string) => (sel === "button" ? [button] : []),
      closest: () => null,
    };
    return { form, refusedSpan };
  }

  function stubGlobals(jsonBody: unknown) {
    const realFetch = globalThis.fetch;
    const realFormData = globalThis.FormData;
    const realLocation = (globalThis as { location?: unknown }).location;
    let reloaded = false;
    (globalThis as unknown as { FormData: unknown }).FormData = class {
      constructor(_form: unknown) {}
      forEach(): void {}
    };
    (globalThis as unknown as { location: unknown }).location = {
      href: "http://dash.test/projects/aide",
      pathname: "/projects/aide",
      reload: () => {
        reloaded = true;
      },
    };
    (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
      ok: true,
      json: async () => jsonBody,
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

  const submitEvent = () => ({ defaultPrevented: false, preventDefault: () => {} }) as unknown as Event;

  test("shows the waiting note, and skips the restarting note, when restartWaiting is present (REQ-1, REQ-2)", async () => {
    const { form, refusedSpan } = fakeForm();
    const stub = stubGlobals({ ok: true, restartWaiting: ["ab12cd34"] });
    try {
      await submitDeploy(form as unknown as HTMLFormElement, submitEvent());
      expect(refusedSpan.textContent).toContain("the restart is waiting for running jobs: ab12cd34");
      expect(refusedSpan.textContent).not.toContain("the dashboard is restarting");
      expect(stub.reloaded()).toBe(true);
    } finally {
      stub.restore();
    }
  });

  test("still shows the restarting note when restartWaiting is absent (REQ-5)", async () => {
    const { form, refusedSpan } = fakeForm();
    const stub = stubGlobals({ ok: true, restarting: true });
    try {
      await submitDeploy(form as unknown as HTMLFormElement, submitEvent());
      expect(refusedSpan.textContent).toContain("deployed — the dashboard is restarting");
      expect(stub.reloaded()).toBe(true);
    } finally {
      stub.restore();
    }
  });
});
