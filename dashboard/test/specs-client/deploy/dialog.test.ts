// The Deploy dialog's DOM work (`specs-client/deploy/index.ts`), on the
// server's own markup in happy-dom, as the Reopen dialog's tests are.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { deployDialog } from "../../../src/render/pages/projects-page/deploy-dialog.ts";
import { submitDeploy } from "../../../src/specs-client/deploy/index.ts";
import type { DeployIo, StepAnswer } from "../../../src/specs-client/deploy/run.ts";

function page(withShowModal = true) {
  const window = new Window();
  const events: string[] = [];
  window.document.addEventListener("aide-overlay-open", () => events.push("aide-overlay-open"));
  window.document.body.innerHTML =
    `<main><form class="deployform" action="http://dash.test/api/queue/projects/aide/deploy">` +
    `<button>Deploy</button>${deployDialog("en")}</form></main>`;
  const form = window.document.querySelector("form") as unknown as HTMLFormElement;
  const dialog = window.document.querySelector("dialog") as unknown as HTMLDialogElement;
  if (!withShowModal) (dialog as { showModal?: unknown }).showModal = undefined;
  const state = (step: string): string | undefined =>
    (window.document.querySelector(`[data-step="${step}"]`) as HTMLElement | null)?.dataset.state;
  const submit = (io: DeployIo) => {
    const event = new window.Event("submit", { cancelable: true });
    return { event, done: submitDeploy(form, event as unknown as Event, io) };
  };
  return { window, form, dialog, events, state, submit };
}

/** An io whose posts answer from `answers`, and whose `fetch` can be
 *  held to look at the dialog while a step runs. */
function fakeIo(answers: Record<string, StepAnswer> = {}, probes: (string | null)[] = ["new"]) {
  const io = { reloads: 0, release: () => {}, hold: false } as DeployIo & { reloads: number; release: () => void; hold: boolean };
  let probed = 0;
  io.post = async (step) => {
    if (step === "fetch" && io.hold) await new Promise<void>((r) => (io.release = r));
    return answers[step] ?? (step === "restart" ? { ok: true, restart: "fired", startedAt: "old" } : { ok: true });
  };
  io.version = async () => {
    const next = probes[Math.min(probed++, probes.length - 1)];
    if (next === null) throw new Error("down");
    return { startedAt: next };
  };
  io.sleep = async () => {};
  io.reload = () => void io.reloads++;
  return io;
}

const closeButton = (window: Window): HTMLElement =>
  window.document.querySelector("[data-deploy-close]") as unknown as HTMLElement;

const cancel = (window: Window, dialog: HTMLDialogElement): boolean => {
  const event = new window.Event("cancel", { cancelable: true });
  (dialog as unknown as EventTarget).dispatchEvent(event as unknown as Event);
  return event.defaultPrevented;
};

describe("submitDeploy", () => {
  test("opens the dialog as a modal and raises no overlay event (AC-1)", async () => {
    const { dialog, events, submit } = page();
    const io = fakeIo();
    io.hold = true;
    const { event, done } = submit(io);
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    io.release();
    await done;
    expect(events).toEqual([]);
  });

  test("a step's line says running while it runs, and every state word is the page's own (AC-3)", async () => {
    const { state, submit, window } = page();
    const io = fakeIo();
    io.hold = true;
    const { done } = submit(io);
    expect(state("fetch")).toBe("running");
    expect(state("install")).toBe("waiting");
    expect(window.document.querySelector('[data-step="fetch"] .deploystate')?.textContent).toBe("running");
    io.release();
    await done;
    expect(state("check")).toBe("done");
  });

  test("a finished run says so, then closes the dialog before the reload (AC-4)", async () => {
    const { dialog, window, submit } = page();
    const io = fakeIo();
    let sawFinished = "";
    let openAtReload = true;
    io.sleep = async () => {
      sawFinished = window.document.querySelector(".deploymessage")?.textContent ?? "";
    };
    io.reload = () => {
      openAtReload = dialog.open;
    };
    await submit(io).done;
    expect(sawFinished).toBe("Deploy finished");
    expect(openAtReload).toBe(false);
  });

  test("a failure stays open with the error in the board's message layout and a Close button, and does not reload (AC-5)", async () => {
    const { dialog, window, state, submit } = page();
    const io = fakeIo({ install: { ok: false, error: "the install command failed (exit 1)" } });
    await submit(io).done;
    expect(dialog.open).toBe(true);
    expect(io.reloads).toBe(0);
    expect(state("install")).toBe("failed");
    expect(state("restart")).toBe("waiting");
    const message = window.document.querySelector(".deploymessage .rowmsg.failed");
    expect(message?.textContent).toContain("The install command failed (exit 1)");
    expect(message?.querySelector("svg")).not.toBeNull();
    expect(dialog.hasAttribute("data-failed")).toBe(true);
  });

  test("Escape does nothing while a step runs; after a failure Escape and Close both close it (AC-5)", async () => {
    const first = page();
    const running = fakeIo();
    running.hold = true;
    const { done } = first.submit(running);
    expect(cancel(first.window, first.dialog)).toBe(true);
    running.release();
    await done;

    const failed = page();
    await failed.submit(fakeIo({ fetch: { ok: false, error: "no" } })).done;
    expect(cancel(failed.window, failed.dialog)).toBe(false);
    closeButton(failed.window).click();
    expect(failed.dialog.open).toBe(false);
  });

  test("Close reloads the page after a failure that carried faulty: true, and not after any other (AC-7)", async () => {
    const faulty = page();
    const faultyIo = fakeIo({ check: { ok: false, error: "older", faulty: true } });
    await faulty.submit(faultyIo).done;
    expect(faultyIo.reloads).toBe(0);
    closeButton(faulty.window).click();
    expect(faultyIo.reloads).toBe(1);

    const plain = page();
    const plainIo = fakeIo({ fetch: { ok: false, error: "no" } });
    await plain.submit(plainIo).done;
    closeButton(plain.window).click();
    expect(plainIo.reloads).toBe(0);
  });

  test("a service that never answered puts the error in front of <main> on Close, without a reload (AC-7)", async () => {
    const { window, dialog, submit } = page();
    const io = fakeIo({}, [null]);
    // One probe is enough: a service that never answers.
    await submit(io).done;
    expect(dialog.querySelector(".deploymessage .rowmsg.failed")?.textContent).toContain("did not answer");
    closeButton(window).click();
    const shown = window.document.querySelector("main")?.previousElementSibling;
    expect(shown?.classList.contains("rowmsg")).toBe(true);
    expect(shown?.classList.contains("failed")).toBe(true);
    expect(shown?.classList.contains("deploy-fault")).toBe(true);
    expect(shown?.textContent).toContain("did not answer");
    expect(io.reloads).toBe(0);
  });

  test("with no showModal the form posts natively (AC-1)", async () => {
    const { submit } = page(false);
    const { event, done } = submit(fakeIo());
    await done;
    expect(event.defaultPrevented).toBe(false);
  });
});
