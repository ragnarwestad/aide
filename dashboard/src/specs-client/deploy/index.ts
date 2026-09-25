// The Deploy button's dialog: opens on submit at its final size, moves
// one step line at a time as the sequence (`run.ts`) reports, and after
// a failure stays until it is closed. With no `<dialog>` the form posts
// natively and follows the redirect, as it always did.

import { runDeploy, STEPS, type DeployFailure, type DeployIo, type DeployStep, type PostedStep, type StepAnswer, type StepState } from "./run.ts";

/** What a dialog is doing, kept per dialog so its listeners are attached
 *  once however many times it is submitted. */
interface Standing {
  running: boolean;
  /** The failure not yet dismissed. */
  failure: DeployFailure | null;
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

export async function submitDeploy(form: HTMLFormElement, event: Event, io: DeployIo = browserIo(form)): Promise<void> {
  if (event.defaultPrevented) return;
  const dialog = form.querySelector("dialog[data-deploy-dialog]") as HTMLDialogElement | null;
  // No `<dialog>` here: the form posts natively and follows the redirect.
  if (!dialog || typeof dialog.showModal !== "function") return;
  event.preventDefault();
  const list = dialog.querySelector("ol.deploysteps") as HTMLElement;
  const messageBox = dialog.querySelector(".deploymessage") as HTMLElement;

  let mine = standing.get(dialog);
  if (!mine) {
    const fresh: Standing = { running: false, failure: null };
    mine = fresh;
    standing.set(dialog, fresh);
    // What the reader does about a failure: a stored fault is drawn by
    // the server, so the page reloads; a silent service can only be
    // said by the page already loaded.
    const dismiss = (): void => {
      const failure = fresh.failure;
      fresh.failure = null;
      if (dialog.open) dialog.close();
      if (!failure) return;
      if (failure.faulty) {
        io.reload();
        return;
      }
      if (!failure.silent) return;
      const message = errorMessage(dialog, dialog.dataset.noAnswer ?? "");
      message?.classList.replace("deploy-error", "deploy-fault");
      if (message) dialog.ownerDocument.querySelector("main")?.before(message);
    };
    dialog.addEventListener("cancel", (e) => {
      if (fresh.running) e.preventDefault();
    });
    // A browser can close a modal whose cancel was prevented (a second
    // Escape): stand again while running, dismiss once it has failed.
    dialog.addEventListener("close", () => {
      if (fresh.running) dialog.showModal();
      else dismiss();
    });
    dialog.querySelector("[data-deploy-close]")?.addEventListener("click", dismiss);
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
  dialog.removeAttribute("data-failed");
  state.running = true;
  state.failure = null;
  if (!dialog.open) dialog.showModal();

  await runDeploy(io, {
    state: setState,
    fail: (step, failure) => {
      setState(step, "failed");
      const message = errorMessage(dialog, failure.silent ? (dialog.dataset.noAnswer ?? "") : failure.error || "the request failed");
      if (message) messageBox.replaceChildren(message);
      state.running = false;
      state.failure = failure;
      dialog.setAttribute("data-failed", "");
    },
    finished: () => {
      messageBox.textContent = dialog.dataset.finished ?? "";
    },
    close: () => {
      state.running = false;
      if (dialog.open) dialog.close();
    },
  });
}
