import { describe, expect, test } from "bun:test";
import { interceptCancelSubmit } from "../../src/queue-client/cancel-confirm.ts";

// A direct unit test of the interceptor itself, rather than through the
// `queue-client.ts` bundle harness (`fixtures.ts`): that fake document
// keeps one listener per event type (`on[type] = fn`), so a second
// "submit" listener registered there would silently replace the first
// rather than run alongside it, the way two real DOM listeners do.

function makeForm(hasCancelform: boolean, dialog: unknown): HTMLFormElement {
  const form = {
    parentElement: {
      querySelector: (sel: string) => (sel === "dialog.confirmdialog" ? dialog : null),
    },
  } as unknown as HTMLFormElement;
  (form as unknown as { closest: (sel: string) => unknown }).closest = (sel: string) =>
    hasCancelform && sel === "form.cancelform" ? form : null;
  return form;
}

function makeEvent(target: unknown, defaultPrevented = false): Event {
  let prevented = defaultPrevented;
  return {
    target,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as Event;
}

describe("interceptCancelSubmit", () => {
  test("a submit on form.cancelform opens the dialog and stops the post (criterion 1)", () => {
    let opened = false;
    const dialog = { showModal: () => void (opened = true) };
    const event = makeEvent(makeForm(true, dialog));
    interceptCancelSubmit(event);
    expect(event.defaultPrevented).toBe(true);
    expect(opened).toBe(true);
  });

  test("a submit on a form without the cancelform class is left alone", () => {
    const dialog = { showModal: () => { throw new Error("must not be called"); } };
    const event = makeEvent(makeForm(false, dialog));
    interceptCancelSubmit(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("a submit already cancelled by an earlier listener is left alone", () => {
    let opened = false;
    const dialog = { showModal: () => void (opened = true) };
    const event = makeEvent(makeForm(true, dialog), true);
    interceptCancelSubmit(event);
    expect(opened).toBe(false);
  });

  test("no dialog sibling: nothing intercepted, the form posts as normal", () => {
    const event = makeEvent(makeForm(true, null));
    interceptCancelSubmit(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("a browser with no <dialog> support submits normally", () => {
    const event = makeEvent(makeForm(true, {}));
    interceptCancelSubmit(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
