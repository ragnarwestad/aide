// A Save that has been pressed looks pressed, on the pages that post a
// real form and wait for the answer.
//
// The spec list gets this from `queue-client.ts`, which intercepts the
// press, fetches, and marks the button busy itself. The pages that are
// nothing but a form — the spec editor above all — carry no script at
// all on purpose: they post to a real route and follow the 303 back.
// Saving a description commits and pushes, which takes two or three
// seconds, and for those seconds the button looked untouched. A button
// that looks untouched reads as a button that did not register the
// click, so it gets pressed again.
//
// What changes is the LOOK, not the word: a button that swapped "Save"
// for "saving…" would grow to fit and shove the row it sits in (spec
// 104). It goes `busy` — the variant the server already renders for
// work in flight — the pending word moves to the `title`, where it
// costs no width, and the spinner goes inside the button, where it
// costs none either. Character for character what `queue-client.ts`
// does, for the same reason.
//
// ONE listener, on `document`, rather than a wire-up per form: this
// file is transpiled into the shell's head script, which runs before
// the body is parsed, so there are no forms yet to attach anything to.
// Submit events bubble, so the document hears them all.
//
// Like `unit-script.ts`, it can neither import nor export anything;
// `test/form-busy.test.ts` runs it against a fake document.

(() => {
  /** Character for character what `components.ts` renders. */
  const SPINNER = '<span class="spin" aria-hidden="true"></span>';
  /** The variants a button can be wearing when it is pressed. It stops
   *  wearing one while it is busy — `.btn.busy` is the whole look. */
  const VARIANTS = ["primary", "danger"];

  document.addEventListener("submit", (event: Event) => {
    // A form `queue-client.ts` owns has already been handled: it
    // called preventDefault on its way past, and marking its button a
    // second time would put two spinners in it.
    if (event.defaultPrevented) return;
    const form = event.target as (HTMLFormElement & { dataset: Record<string, string> }) | null;
    if (!form || !form.dataset) return;
    // A second press while the first is still out. The page is about to
    // be replaced by the answer to the first, so the second is refused
    // rather than sent: the request behind these buttons commits and
    // pushes, and doing that twice is not a slower version of doing it
    // once.
    if (form.dataset.busy === "on") {
      event.preventDefault();
      return;
    }
    // The button that was pressed, or — Enter from inside a field —
    // the one the browser would have used.
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const button =
      submitter && submitter.tagName === "BUTTON"
        ? submitter
        : (form.querySelector("button[type=submit]") as HTMLButtonElement | null);
    if (!button) return;
    form.dataset.busy = "on";
    // NOT `disabled`: the entry list is built AFTER this event, so a
    // control disabled here posts nothing. The button carries no name
    // today, but a page that gave it one would lose it silently, and
    // the guard against a second press is the flag above.
    for (const variant of VARIANTS) button.classList.remove(variant);
    button.classList.add("busy");
    button.setAttribute("aria-busy", "true");
    // "" rather than the other empty value, whose NAME the spec editor's
    // page test bans from the rendered HTML — a printed one is a bug on
    // every other page here, and the guard cannot tell inline script
    // from markup.
    const pending = button.dataset ? button.dataset.pending : "";
    if (pending) button.title = pending;
    button.insertAdjacentHTML("afterbegin", SPINNER);
  });
})();
