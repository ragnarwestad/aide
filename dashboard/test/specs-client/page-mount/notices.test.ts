import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { dismissCheckoutWarning } from "../../../src/specs-client/page-mount/notices.ts";

test("Dismiss removes only an unfinished checkout warning, without changing other faults", async () => {
  const win = new Window();
  try {
    const doc = win.document;
    doc.body.innerHTML = `<p class="checkout-fault waiting"><button data-dismiss-checkout-warning>Dismiss</button></p><p class="checkout-fault failed">Fault</p>`;
    doc.body.addEventListener("click", (event) => dismissCheckoutWarning(event as unknown as Event));
    (doc.querySelector("button") as unknown as HTMLButtonElement).click();
    expect(doc.querySelector(".waiting")).toBeNull();
    expect(doc.querySelector(".failed")).not.toBeNull();
    doc.body.innerHTML = `<p class="checkout-fault failed"><button data-dismiss-checkout-warning>Dismiss</button></p>`;
    (doc.querySelector("button") as unknown as HTMLButtonElement).click();
    expect(doc.querySelector(".failed")).not.toBeNull();
  } finally {
    await win.happyDOM.close();
  }
});
