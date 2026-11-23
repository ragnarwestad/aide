// A press on the search line's Search button leaves the focus in the field,
// so the button a phone shows only while the field is typed in is still
// there when the click arrives. Any other press takes the focus as usual.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { keepSearchFocus } from "../../../src/specs-client/forms.ts";

function press(selector: string): boolean {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML =
    `<form class="specsearch"><input name="q"><button data-search-submit>Search</button><button class="btn primary">New</button></form>`;
  document.body.addEventListener("pointerdown", (event) => keepSearchFocus(event as unknown as Event));
  const event = new window.Event("pointerdown", { bubbles: true, cancelable: true });
  document.querySelector(selector)!.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("a press on the search line", () => {
  test("on Search keeps the focus in the field", () => {
    expect(press("[data-search-submit]")).toBe(true);
  });

  test("anywhere else takes the focus as usual", () => {
    expect(press(".btn.primary")).toBe(false);
  });
});
