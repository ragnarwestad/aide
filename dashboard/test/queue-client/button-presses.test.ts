import { describe, expect, test } from "bun:test";
import {
  CONTROLS,
  harness,
  OK_ACTION,
  swapUrl,
} from "./fixtures.ts";


describe("a row button posts from the page (criteria 10-12)", () => {
  test("it asks for JSON on the form's own route, and carries the token", async () => {
    const h = harness((url) => (url.includes("/cancel") ? { ok: true, body: OK_ACTION } : { ok: true }));
    await h.submit();
    const posted = h.requests.find((r) => r.url.includes("/cancel"))!;
    expect(posted.init.method).toBe("POST");
    expect((posted.init.headers as Record<string, string>).accept).toBe("application/json");
    // The guard reads a header, the query string or the cookie — never
    // the form body, which is where the hidden field would have gone.
    expect(posted.url).toContain("token=s3cret");
  });

  // Spec 104: it says so by CHANGING, not by changing its word. The
  // pending wording is still the server's, and still shown — as the
  // button's `title`, where it costs no width.
  test("the button says so at once, instead of looking untouched (criterion 10)", async () => {
    let seenBusy = false;
    let seenTitle = "";
    const h = harness((url) => {
      if (url.includes("/cancel")) {
        seenBusy = h.button.classList.contains("busy");
        seenTitle = h.button.title;
      }
      return { ok: true, body: OK_ACTION };
    });
    await h.submit();
    expect(seenBusy).toBe(true);
    expect(seenTitle).toBe("cancelling…");
    // And the page stayed where the reader was.
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("the rows are swapped as soon as the answer arrives, not on the next tick (criterion 11)", async () => {
    const h = harness(() => ({ ok: true, body: OK_ACTION }));
    await h.submit();
    expect(swapUrl(h)).toContain("rows=1");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });

  // The five-second tick swaps `#jobrows` from the server. While a press
  // is in flight the server still shows the OLD state, so a swap in that
  // window put back an untouched label over the pending one the press
  // had just shown — seen on 2026-08-19: no feedback, then a jump. The
  // tick waits while anything is in flight.
  test("the tick does not swap the rows while a press is in flight", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const h = harness((url) => (url.includes("/cancel") ? { ok: true, body: OK_ACTION, hold: held } : { ok: true }));
    h.document.visibilityState = "visible";
    const pressed = h.submit();
    await Promise.resolve();
    h.tick();
    await Promise.resolve();
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(0);
    expect(h.button.classList.contains("busy")).toBe(true);
    release();
    await pressed;
    // Once the answer is in, the rows are fetched (criterion 11) — once.
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(1);
    h.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(2);
  });

  // The reload keeps the reader's view: a press that failed while the
  // server restarted used to land on a bare `/`, and the sort and
  // filter they had set were gone (seen 2026-08-19: "Spec ▴" reset to
  // "Started ▾" with no press of theirs).
  test("a press that cannot be sent at all reloads rather than lying — and keeps the view (criterion 12)", async () => {
    const h = harness(() => ({ ok: false, throws: true }), "actionform", "?sort=spec&dir=asc");
    await h.submit();
    expect(h.location.href).toBe("/?sort=spec&dir=asc");
  });

  // A form whose own onsubmit cancelled the event is not ours to post:
  // a delegated handler that ignored that would post anyway.
  test("a submit that was already cancelled posts nothing", async () => {
    const h = harness(() => ({ ok: true, body: OK_ACTION }), "actionform");
    await h.submit({ defaultPrevented: true });
    expect(h.requests).toHaveLength(0);
    expect(h.button.disabled).toBe(false);
    expect(h.button.textContent).toBe("Cancel");
  });
});
// --- spec 99/101: the view survives the press, and the row gets the reason ---

// Merging from the page goes through this file, not through the form
// POST — so the server's redirect fix reaches nobody with JavaScript on
// unless what this file does carries the same two things. Spec 101 took
// the navigation itself out: the query the server would have redirected
// to is written with `history.replaceState` and the rows are swapped, so
// the reader keeps the page, the scroll position and the form they were
// filling in.
describe("a refused action keeps the view and names its spec (criteria 7, 8)", () => {
  // One sentence, not a list: the route that answered per repo was the
  // merge route, and it went with the button (spec 149).
  const REFUSED = {
    ok: false,
    spec: "aide/99-merge-leaves-nothing-behind",
    error: "the tree is dirty in /repos/aide-specs",
  };

  test("the current filter and sort come along", async () => {
    const h = harness(
      (url) => (url.includes("/cancel") ? { ok: true, body: REFUSED } : { ok: true }),
      "actionform",
      "?state=active&sort=cost&token=s3cret",
    );
    await h.submit();
    const to = new URL(h.replaced[0]!, "http://dash.test");
    expect(to.pathname).toBe("/");
    expect(to.searchParams.get("state")).toBe("active");
    expect(to.searchParams.get("sort")).toBe("cost");
    // The token is handed over once as a cookie; carrying it back into
    // the address bar would put it in history for no reason.
    expect(to.searchParams.get("token")).toBeNull();
  });

  test("the spec the server named rides along, so the row can show it", async () => {
    const h = harness((url) => (url.includes("/cancel") ? { ok: true, body: REFUSED } : { ok: true }));
    await h.submit();
    const to = new URL(h.replaced[0]!, "http://dash.test");
    expect(to.searchParams.get("errorSpec")).toBe("aide/99-merge-leaves-nothing-behind");
    expect(to.searchParams.get("error")).toContain("the tree is dirty");
  });

  test("a refusal the server did not attribute still says the reason", async () => {
    const h = harness((url) =>
      url.includes("/cancel") ? { ok: true, body: { ok: false, error: "the tree is dirty" } } : { ok: true },
    );
    await h.submit();
    const to = new URL(h.replaced[0]!, "http://dash.test");
    expect(to.searchParams.get("error")).toContain("the tree is dirty");
    expect(to.searchParams.get("errorSpec")).toBeNull();
  });

  // Spec 101, criterion 6: the message lands on the row without the
  // page moving. The rows are re-fetched with the same query the
  // address bar now holds, so the reason comes back rendered on the
  // spec it belongs to — and nothing scrolled.
  test("the page does not navigate, and the rows are re-asked with the reason", async () => {
    const h = harness((url) => (url.includes("/cancel") ? { ok: true, body: REFUSED } : { ok: true }));
    await h.submit();
    expect(h.location.href).toBe("http://dash.test/");
    expect(decodeURIComponent(swapUrl(h))).toContain("errorSpec=aide/99-merge-leaves-nothing-behind");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });
});
// --- spec 101: every control answers the press ------------------------------

// Run and Cancel were plain form posts: the browser navigated on the
// click, the button froze mid-navigation, and the redirect target
// re-rendered the whole page (a git call per spec) before anything came
// back. Same request, same route, same answer — the wait and the jump
// are what go.
describe("every action button says it was pressed (criteria 4, 5)", () => {
  const OK = { ok: true, job: { id: "job-1" } };

  for (const formClass of ["rowrun", "actionform"] as const) {
    test(`${formClass} changes its button before the answer arrives`, async () => {
      let seen = false;
      const h = harness(
        (url) => {
          if (url.includes("/api/queue")) seen = h.button.classList.contains("busy");
          return { ok: true, body: OK };
        },
        formClass,
      );
      await h.submit();
      expect(seen).toBe(true);
      // And it is put back when the request is over, in case the swap
      // left this very button standing.
      expect(h.button.textContent).toBe(CONTROLS[formClass]!.label);
      expect(h.button.classList.contains("busy")).toBe(false);
      expect(h.button.disabled).toBe(false);
    });

    test(`${formClass} swaps the rows in place instead of navigating`, async () => {
      const h = harness(() => ({ ok: true, body: OK }), formClass);
      await h.submit();
      expect(swapUrl(h)).toContain("rows=1");
      expect(h.rows.innerHTML).toBe("<tr></tr>");
      expect(h.location.href).toBe("http://dash.test/");
    });

    test(`a refused ${formClass} lands on the row, without the page moving`, async () => {
      const h = harness(
        (url) =>
          url.includes("rows=1")
            ? { ok: true }
            : { ok: false, body: { error: "analyze is already running on this spec", spec: "aide/101-x" } },
        formClass,
      );
      await h.submit();
      const to = new URL(h.replaced[0]!, "http://dash.test");
      expect(to.searchParams.get("error")).toContain("already running");
      expect(to.searchParams.get("errorSpec")).toBe("aide/101-x");
      expect(h.location.href).toBe("http://dash.test/");
      expect(h.rows.innerHTML).toBe("<tr></tr>");
    });
  }

  // Merge needs no body; Run IS its body — the phases, the model, the
  // other repos and the gate are all in the form, and a POST that
  // dropped them would queue something else than what was ticked.
  test("Run sends the form's own fields", async () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    await h.submit();
    const post = h.requests.find((r) => r.init.method === "POST")!;
    expect(String(post.init.body)).toContain("steps=analyze");
    expect((post.init.headers as Record<string, string>)["content-type"]).toContain(
      "application/x-www-form-urlencoded",
    );
  });
});

// The one form that is not about a spec that exists. It has no row for
// a refusal to land on — the spec it names was never made — so the
// reason goes beside the form the reader was typing into.
describe("the New-spec form answers for itself (criteria 7, 8)", () => {
  test("a refusal is written beside the form, and the reader stays on the page", async () => {
    const h = harness(() => ({ ok: false, body: { error: "no such project: nope" } }));
    await h.submitCreate();
    expect(h.slot.textContent).toContain("no such project");
    // Still on `/new`, with everything typed still typed.
    expect(h.location.href).toBe("http://dash.test/");
    expect(h.resets).toHaveLength(0);
    expect(h.replaced).toHaveLength(0);
  });

  // Spec 121, criterion 8. The form has a page of its own now: there is
  // no panel to shut, no #jobrows beside it to swap, and the thing the
  // reader asked to see — the new spec's row, with its progress — is on
  // the page this navigates to.
  test("a created spec takes the reader back to the list", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true, job: { id: "job-2" } } }));
    await h.submitCreate();
    expect(h.location.href).toBe("/");
    // Nothing is put back in place first: the reader has left.
    expect(h.resets).toHaveLength(0);
    expect(h.requests.some((r) => r.url.includes("rows=1"))).toBe(false);
  });

  // Spec 104 changed what the four ROW buttons do while their request
  // is out, and deliberately left this one alone: it has no row to
  // shift and no phase boxes to lend their space, so the word it swaps
  // to costs nothing.
  test("the button says it is working, and its fields go with it", async () => {
    let seen = "";
    let seenBusy = false;
    const h = harness((url) => {
      if (url.includes("/create")) {
        seen = h.createButton.textContent;
        seenBusy = h.createButton.classList.contains("busy");
      }
      return { ok: true, body: { ok: true } };
    });
    await h.submitCreate();
    expect(seen).toBe("creating…");
    expect(seenBusy).toBe(false);
    const post = h.requests.find((r) => r.url.includes("/create"))!;
    expect(String(post.init.body)).toContain("title=A+spec");
  });

  test("a refusal already answered by something else is left alone", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    await h.submitCreate({ defaultPrevented: true });
    expect(h.requests).toHaveLength(0);
  });
});
// --- spec 110: the Depends-on chips follow the chosen project ----------------

// A dependency is resolved inside ONE specs root, so a chip belonging to
// another project is not a choice anyone can make. The server refuses it
// either way; this is the half that means nobody has to be refused to
// find out.
describe("the Depends-on chips are scoped to the chosen project", () => {
  test("only the chosen project's chips are live, from the moment the page loads", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    expect(h.chips[0]!.hidden).toBe(false);
    expect(h.chips[0]!.input.disabled).toBe(false);
    expect(h.chips[1]!.hidden).toBe(true);
    expect(h.chips[1]!.input.disabled).toBe(true);
  });

  test("changing the project swaps which ones are live, and unticks what it hides", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.chips[0]!.input.checked = true;
    h.changeProject("aide-dashboard");
    expect(h.chips[0]!.hidden).toBe(true);
    expect(h.chips[0]!.input.disabled).toBe(true);
    // A hidden box the reader can no longer see is not a choice they
    // are still making.
    expect(h.chips[0]!.input.checked).toBe(false);
    expect(h.chips[1]!.hidden).toBe(false);
    expect(h.chips[1]!.input.disabled).toBe(false);
  });

  // Spec 121 retired the re-sync that used to follow a create: the
  // success path navigates now, so there is no reset to chase and no
  // half-cleared form to leave behind. What the reader picked stands
  // until the browser leaves the page.
  test("a successful create leaves them alone — the page is on its way out", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true, job: { id: "job-2" } } }));
    h.changeProject("aide-dashboard");
    expect(h.chips[1]!.hidden).toBe(false);
    await h.submitCreate();
    expect(h.location.href).toBe("/");
    expect(h.projectSelect.value).toBe("aide-dashboard");
    expect(h.chips[1]!.hidden).toBe(false);
  });
});
