// The Deploy button's dialog: opens on submit at its final size, moves
// one step line at a time as the sequence (`run.ts`) reports, and after
// a failure closes by itself and leaves the error on the Deploy panel.
// With no `<dialog>` the form posts natively and follows the redirect,
// as it always did.

import { runDeploy, STEPS, type DeployFailure, type DeployIo, type DeployStep, type PostedStep, type StepAnswer, type StepState } from "./run.ts";

/** What a dialog is doing, kept per dialog so its listeners are attached
 *  once however many times it is submitted. */
interface Standing {
  running: boolean;
  /** The failure not yet handed to the page, with its step's label. */
  failure: (DeployFailure & { label: string }) | null;
  /** The newest run: an older run's pause must not close a newer dialog. */
  run: number;
  io: DeployIo;
  /** Closes the dialog and hands a failure to the page; safe to call twice. */
  dismiss: () => void;
}
const standing = new WeakMap<object, Standing>();

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function browserIo(form: HTMLFormElement): DeployIo {
  return {
    post: async (step: PostedStep) => {
      const res = await fetch(`${form.action}/${step}`, { method: "POST", headers: { accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as StepAnswer | null;
      return { ...body, ok: res.ok && body?.ok === true };
    },
    version: async () => {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) throw new Error("the service did not answer");
      return (await res.json()) as { startedAt?: string | null };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    reload: () => location.reload(),
  };
}

/** The error in the board's own message layout, from the template the
 *  server drew into the dialog. */
function errorMessage(dialog: HTMLDialogElement, text: string): Element | null {
  const template = dialog.querySelector("template[data-deploy-error]") as HTMLTemplateElement | null;
  const message = template?.content.firstElementChild?.cloneNode(true) as Element | undefined;
  const span = message?.querySelector("span");
  if (!message || !span) return null;
  span.textContent = capitalize(text);
  return message;
}

/** The deploy errors standing directly on the Deploy panel. */
const panelErrors = (panel: Element | null): Element[] =>
  [...(panel?.children ?? [])].filter((child) => child.classList.contains("deploy-error"));

/** The failed-step sentence: `{step}` first, then `{error}`, both by
 *  function so neither is read for `$` patterns or substituted twice. */
const failedSentence = (template: string, label: string, error: string): string =>
  template.replace("{step}", () => label).replace("{error}", () => error);

export async function submitDeploy(form: HTMLFormElement, event: Event, io: DeployIo = browserIo(form)): Promise<void> {
  if (event.defaultPrevented) return;
  const dialog = form.querySelector("dialog[data-deploy-dialog]") as HTMLDialogElement | null;
  // No `<dialog>` here: the form posts natively and follows the redirect.
  if (!dialog || typeof dialog.showModal !== "function") return;
  event.preventDefault();
  const list = dialog.querySelector("ol.deploysteps") as HTMLElement;
  const messageBox = dialog.querySelector(".deploymessage") as HTMLElement;

  const panel = dialog.closest(".deploypanel");

  let mine = standing.get(dialog);
  if (!mine) {
    const fresh: Standing = { running: false, failure: null, run: 0, io, dismiss: () => {} };
    mine = fresh;
    standing.set(dialog, fresh);
    // What becomes of a failure once the dialog is gone: a stored fault is
    // drawn by the server, so the page reloads; anything else is drawn
    // here, first on the Deploy panel, and a silent service also at the
    // top of the page, since only the page already loaded can say it.
    fresh.dismiss = (): void => {
      const failure = fresh.failure;
      fresh.failure = null;
      if (dialog.open) dialog.close();
      if (!failure) return;
      if (failure.faulty) {
        fresh.io.reload();
        return;
      }
      const noAnswer = dialog.dataset.noAnswer ?? "";
      const reason = failure.silent ? noAnswer : failure.error || "the request failed";
      const message = errorMessage(dialog, failedSentence(dialog.dataset.failedAt ?? "{step}: {error}", failure.label, reason));
      if (message) panel?.prepend(message);
      if (!failure.silent) return;
      const top = errorMessage(dialog, noAnswer);
      top?.classList.replace("deploy-error", "deploy-fault");
      if (top) dialog.ownerDocument.querySelector("main")?.before(top);
    };
    dialog.addEventListener("cancel", (e) => {
      if (fresh.running) e.preventDefault();
    });
    // A browser can close a modal whose cancel was prevented (a second
    // Escape): stand again while running, hand over the failure once it
    // has failed.
    dialog.addEventListener("close", () => {
      if (fresh.running) dialog.showModal();
      else fresh.dismiss();
    });
  }
  const state = mine;

  const line = (step: DeployStep): HTMLElement => list.querySelector(`[data-step="${step}"]`) as HTMLElement;
  const setState = (step: DeployStep, to: StepState): void => {
    const li = line(step);
    li.dataset.state = to;
    const word = li.querySelector(".deploystate");
    if (word) word.textContent = list.dataset[to] ?? to;
  };
  for (const step of STEPS) setState(step, "waiting");
  messageBox.replaceChildren();
  for (const error of panelErrors(panel)) error.remove();
  const token = ++state.run;
  state.io = io;
  state.running = true;
  state.failure = null;
  if (!dialog.open) dialog.showModal();

  await runDeploy(io, {
    state: setState,
    fail: (step, failure) => {
      setState(step, "failed");
      const named = line(step).cloneNode(true) as HTMLElement;
      named.querySelector(".deploystate")?.remove();
      state.running = false;
      state.failure = { ...failure, label: named.textContent?.trim() ?? step };
    },
    finished: () => {
      messageBox.textContent = dialog.dataset.finished ?? "";
    },
    close: () => {
      if (token !== state.run) return;
      state.running = false;
      state.dismiss();
    },
  });
}
