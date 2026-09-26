// The Deploy dialog's DOM work (`specs-client/deploy/index.ts`), on the
// server's own markup in happy-dom, as the Reopen dialog's tests are.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderProjectPage } from "../../../src/render";
import { deployDialog } from "../../../src/render/pages/projects-page/deploy-dialog.ts";
import { submitDeploy } from "../../../src/specs-client/deploy";
import type { DeployIo, StepAnswer } from "../../../src/specs-client/deploy/run.ts";

function page(withShowModal = true) {
  const window = new Window();
  const events: string[] = [];
  window.document.addEventListener("aide-overlay-open", () => events.push("aide-overlay-open"));
  window.document.body.innerHTML =
    `<main><div class="deploypanel"><form class="deployform" action="http://dash.test/api/queue/projects/aide/deploy">` +
    `<button>Deploy</button>${deployDialog("en")}</form></div></main>`;
  const form = window.document.querySelector("form") as unknown as HTMLFormElement;
  const dialog = window.document.querySelector("dialog") as unknown as HTMLDialogElement;
  if (!withShowModal) (dialog as { showModal?: unknown }).showModal = undefined;
  const state = (step: string): string | undefined =>
    (window.document.querySelector(`[data-step="${step}"]`) as HTMLElement | null)?.dataset.state;
  const submit = (io: DeployIo) => {
    const event = new window.Event("submit", { cancelable: true });
    return { event, done: submitDeploy(form, event as unknown as Event, io) };
  };
  const panel = window.document.querySelector(".deploypanel") as unknown as HTMLElement;
  /** The deploy errors standing directly on the panel: what a reader sees. */
  const errors = (): Element[] => [...panel.children].filter((c) => c.classList.contains("deploy-error"));
  return { window, form, dialog, events, state, submit, panel, errors };
}

/** An io whose posts answer from `answers`, and whose `fetch` can be
 *  held to look at the dialog while a step runs. */
function fakeIo(answers: Record<string, StepAnswer> = {}, probes: (string | null)[] = ["new"]) {
  const io = { reloads: 0, release: () => {}, hold: false, holdSleep: false, sleeping: false, releaseSleep: () => {} } as DeployIo & {
    reloads: number;
    release: () => void;
    hold: boolean;
    /** Holds `sleep` (the pause after a failure) until `releaseSleep`. */
    holdSleep: boolean;
    sleeping: boolean;
    releaseSleep: () => void;
  };
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
  io.sleep = async () => {
    if (!io.holdSleep) return;
    io.sleeping = true;
    await new Promise<void>((r) => (io.releaseSleep = r));
    io.sleeping = false;
  };
  io.reload = () => void io.reloads++;
  return io;
}

/** Lets the run reach the held pause. */
async function untilPaused(io: { sleeping: boolean }): Promise<void> {
  for (let n = 0; n < 50 && !io.sleeping; n++) await new Promise((r) => setTimeout(r, 0));
}

const textOf = (el: Element | undefined): string => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";

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

  test("a failure marks its line, keeps the dialog free of any error text, and closes it after the pause (AC-5)", async () => {
    const { dialog, state, submit } = page();
    const io = fakeIo({ install: { ok: false, error: "the install command failed (exit 1)" } });
    io.holdSleep = true;
    const { done } = submit(io);
    await untilPaused(io);
    expect(dialog.open).toBe(true);
    expect(state("install")).toBe("failed");
    expect(state("restart")).toBe("waiting");
    expect(dialog.querySelector(".rowmsg")).toBeNull();
    expect(dialog.querySelector(".deploymessage")?.textContent).toBe("");
    expect(dialog.hasAttribute("data-failed")).toBe(false);
    io.releaseSleep();
    await done;
    expect(dialog.open).toBe(false);
    expect(io.reloads).toBe(0);
  });

  test("the dialog holds no Close button (AC-5)", () => {
    expect(page().dialog.querySelector("[data-deploy-close]")).toBeNull();
  });

  test("a failure that was not faulty draws one error first on the Deploy panel, naming the step and the reason (AC-6)", async () => {
    const { panel, errors, submit } = page();
    const io = fakeIo({ install: { ok: false, error: "the install command failed (exit 1)" } });
    await submit(io).done;
    expect(errors().length).toBe(1);
    expect(panel.firstElementChild).toBe(errors()[0]!);
    expect(errors()[0]!.classList.contains("rowmsg")).toBe(true);
    expect(errors()[0]!.classList.contains("failed")).toBe(true);
    expect(errors()[0]!.querySelector("svg")).not.toBeNull();
    expect(textOf(errors()[0])).toContain("Install failed: the install command failed (exit 1)");
  });

  test("Escape during the pause closes the dialog at once and the failure is handled once (AC-5)", async () => {
    const { window, dialog, errors, submit } = page();
    const io = fakeIo({ fetch: { ok: false, error: "no" } });
    io.holdSleep = true;
    const { done } = submit(io);
    await untilPaused(io);
    expect(cancel(window, dialog)).toBe(false);
    // A dispatched `cancel` closes nothing in happy-dom: the browser's own step.
    dialog.close();
    expect(dialog.open).toBe(false);
    expect(errors().length).toBe(1);
    io.releaseSleep();
    await done;
    expect(errors().length).toBe(1);

    const faulty = page();
    const faultyIo = fakeIo({ fetch: { ok: false, error: "older", faulty: true } });
    faultyIo.holdSleep = true;
    const run = faulty.submit(faultyIo);
    await untilPaused(faultyIo);
    faulty.dialog.close();
    faultyIo.releaseSleep();
    await run.done;
    expect(faultyIo.reloads).toBe(1);
  });

  test("Escape does nothing while a step runs (AC-5)", async () => {
    const { window, dialog, submit } = page();
    const io = fakeIo();
    io.hold = true;
    const { done } = submit(io);
    expect(cancel(window, dialog)).toBe(true);
    io.release();
    await done;
  });

  test("a first run's pause ending after Escape and a second press leaves the second dialog open, and its failure is still handled (AC-5)", async () => {
    const { window, dialog, errors, state, submit } = page();
    const first = fakeIo({ fetch: { ok: false, error: "first" } });
    first.holdSleep = true;
    const run1 = submit(first);
    await untilPaused(first);
    dialog.close();

    const second = fakeIo({ install: { ok: false, error: "second" } });
    second.hold = true;
    const run2 = submit(second);
    expect(dialog.open).toBe(true);
    first.releaseSleep();
    await run1.done;
    expect(dialog.open).toBe(true);
    expect(state("fetch")).toBe("running");
    second.release();
    await run2.done;
    expect(dialog.open).toBe(false);
    expect(errors().length).toBe(1);
    expect(textOf(errors()[0])).toContain("second");
    expect(window.document.querySelector("main")?.previousElementSibling).toBeNull();
  });

  test("a press removes the errors on the panel, the one the script drew and the one the server drew (AC-6)", async () => {
    const { window, panel, errors, dialog, submit } = page();
    const drawn = (cls: string): void => {
      const p = window.document.createElement("p");
      p.className = cls;
      panel.prepend(p as unknown as Node);
    };
    drawn("refusal deploy-error rowmsg failed");
    drawn("deploy-error rowmsg failed");
    expect(errors().length).toBe(2);
    const io = fakeIo();
    io.hold = true;
    const { done } = submit(io);
    expect(dialog.open).toBe(true);
    expect(errors().length).toBe(0);
    io.release();
    await done;
  });

  test("a failure again without a reload leaves one error, the newest (AC-6)", async () => {
    const { errors, submit } = page();
    await submit(fakeIo({ fetch: { ok: false, error: "first" } })).done;
    await submit(fakeIo({ install: { ok: false, error: "second" } })).done;
    expect(errors().length).toBe(1);
    expect(textOf(errors()[0])).toContain("Install failed: second");
  });

  test("a failure that carried faulty: true reloads the page and draws nothing itself (AC-7)", async () => {
    const { errors, submit } = page();
    const io = fakeIo({ check: { ok: false, error: "older", faulty: true } });
    await submit(io).done;
    expect(io.reloads).toBe(1);
    expect(errors().length).toBe(0);
  });

  test("a service that never answered draws the error on the panel and before <main>, without a reload (AC-6, AC-7)", async () => {
    const { window, errors, submit } = page();
    const io = fakeIo({}, [null]);
    // One probe is enough: a service that never answers.
    await submit(io).done;
    expect(errors().length).toBe(1);
    expect(textOf(errors()[0])).toContain("Wait for the service to answer failed:");
    expect(textOf(errors()[0])).toContain("did not answer");
    const shown = window.document.querySelector("main")?.previousElementSibling;
    expect(shown?.classList.contains("rowmsg")).toBe(true);
    expect(shown?.classList.contains("failed")).toBe(true);
    expect(shown?.classList.contains("deploy-fault")).toBe(true);
    expect(textOf((shown ?? undefined) as unknown as Element | undefined)).toContain("did not answer");
    expect(io.reloads).toBe(0);
  });

  test("the script and the server draw the same failure with the same text (AC-6)", async () => {
    const html = renderProjectPage(
      { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] },
      { hasConfigFile: false, rows: [] },
      null,
      "2026-08-31T00:00:00Z",
      [{ label: "Projects", path: "/projects" }],
      {
        worktreeLinkCandidates: [],
        editing: false,
        tab: "deploy",
        drift: { behind: 2, checkedAt: 1735689600000 },
        deployFailure: { step: "install", error: "the install command failed (exit 1)" },
        lang: "en",
      },
    );
    const served = html.match(/<p class="[^"]*deploy-error[^"]*">([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]*>/g, "").trim();
    const { errors, submit } = page();
    await submit(fakeIo({ install: { ok: false, error: "the install command failed (exit 1)" } })).done;
    expect(served).toBe("Install failed: the install command failed (exit 1)");
    expect(textOf(errors()[0])).toBe(served!);
  });

  test("with no showModal the form posts natively (AC-1)", async () => {
    const { submit } = page(false);
    const { event, done } = submit(fakeIo());
    await done;
    expect(event.defaultPrevented).toBe(false);
  });
});
