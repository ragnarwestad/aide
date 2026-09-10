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
      // What the served form carries: the press reads it and covers the
      // page, the same way Reset, Close and Remove project do.
      dataset: { overlay: "deploying…" } as Record<string, string>,
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
    const realDocument = (globalThis as { document?: unknown }).document;
    let reloaded = false;
    // Every event the press raises at the document, in order: the
    // covering layer lives in the shell's own head script, so this is
    // the only side of the conversation reachable from here.
    const raised: { type: string; detail?: string }[] = [];
    (globalThis as unknown as { document: unknown }).document = {
      dispatchEvent: (e: { type: string; detail?: string }) => raised.push({ type: e.type, detail: e.detail }),
    };
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
      raised: () => raised,
      restore: () => {
        globalThis.fetch = realFetch;
        globalThis.FormData = realFormData;
        (globalThis as { location?: unknown }).location = realLocation;
        (globalThis as { document?: unknown }).document = realDocument;
      },
    };
  }

  const submitEvent = () => ({ defaultPrevented: false, preventDefault: () => {} }) as unknown as Event;

  // The restart-waiting sentence says itself on the Deploy tab alone,
  // once the reload lands (project-page.ts) — never here, and never
  // into `.refused`, the slot every genuine refusal uses (spec 431,
  // the same reason `restarting` below stopped doing it on 2026-09-09).
  test("says nothing under the button, and reloads, when restartWaiting is present (spec 431)", async () => {
    const { form, refusedSpan } = fakeForm();
    const stub = stubGlobals({ ok: true, restartWaiting: ["ab12cd34"] });
    try {
      await submitDeploy(form as unknown as HTMLFormElement, submitEvent());
      expect(refusedSpan.textContent).toBe("");
      expect(stub.reloaded()).toBe(true);
    } finally {
      stub.restore();
    }
  });

  // The restart says itself on the covering layer and nowhere else. It
  // was written under the button too, until a deploy that had just
  // succeeded read as an error beside the button that had succeeded
  // (2026-09-09): `formNote` writes into `.refused`, the slot every
  // refusal on the page uses, and the layer does not hide it.
  test("says the restart on the layer alone, leaving the button's refusal slot empty", async () => {
    const { form, refusedSpan } = fakeForm();
    const stub = stubGlobals({ ok: true, restarting: true });
    try {
      await submitDeploy(form as unknown as HTMLFormElement, submitEvent());
      expect(refusedSpan.textContent).toBe("");
      expect(stub.reloaded()).toBe(true);
    } finally {
      stub.restore();
    }
  });

  // A word swap on the button is what `postForm` gives a form outside a
  // table row, and for a deploy that is too little: the service goes
  // down under the page, and every control still showing is one the
  // reader could press into a server that is not there.
  test("the press covers the page at once, and says what is happening on the layer", async () => {
    const { form } = fakeForm();
    const stub = stubGlobals({ ok: true, restarting: true });
    try {
      await submitDeploy(form as unknown as HTMLFormElement, submitEvent());
      const opens = stub.raised().filter((e) => e.type === "aide-overlay-open");
      expect(opens.length).toBe(2);
      // The press raises it off `data-overlay`; the restart note is the
      // one thing a deploy says that the other three do not.
      expect(opens[0]!.detail).toBe("deploying…");
      expect(opens[1]!.detail).toContain("the dashboard is restarting");
      expect(stub.raised().some((e) => e.type === "aide-overlay-close")).toBe(false);
    } finally {
      stub.restore();
    }
  });

  test("a refused deploy uncovers the page again, so the refusal can be read", async () => {
    const { form, refusedSpan } = fakeForm();
    const stub = stubGlobals({ ok: false, error: "no install command configured" });
    try {
      await submitDeploy(form as unknown as HTMLFormElement, submitEvent());
      expect(refusedSpan.textContent).toContain("no install command configured");
      expect(stub.raised().some((e) => e.type === "aide-overlay-close")).toBe(true);
    } finally {
      stub.restore();
    }
  });
});
