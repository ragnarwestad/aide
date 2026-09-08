import { describe, expect, test } from "bun:test";
import { durationLabel } from "../../src/render/ui/job-state.ts";
import {
  harness,
  flush,
  OK_ACTION,
} from "./fixtures.ts";

// --- spec 189: the page changes when something changes -----------------------

// The five-second timer is gone. The page holds one connection open and
// redraws when the server says something moved — so a reader with the
// browser's own tools open can hold still on a row, and a step that
// finishes shows up at once rather than up to five seconds later.
describe("the rows are redrawn on a push, not on a timer (spec 189)", () => {
  const rowFetches = (h: ReturnType<typeof harness>) =>
    h.requests.filter((r) => r.url.includes("rows=1"));

  const fresh = () => harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));

  // It registered NO timer at all until spec 199, which added one that
  // rewrites the text of running-phase marks and does nothing else. The
  // rule spec 189 laid down survives that: no timer FETCHES, so the
  // rows still change only when the server says something moved.
  test("the page's one timer never fetches (criterion 1)", () => {
    const h = fresh();
    h.visibility("visible");
    expect(h.intervals).toEqual([1000]);
    const before = h.requests.length;
    h.ticks.forEach((t) => t());
    expect(h.requests).toHaveLength(before);
  });

  // --- spec 199: a running phase counts up while the reader watches ---
  //
  // Nothing on this page redraws because time passed — that is spec
  // 189's whole point, and it is why an elapsed figure the server drew
  // would sit still until something else happened. The clock below is
  // the exception, and it is deliberately the narrowest one there can
  // be: it rewrites the text of the marks that carry their own start,
  // and touches nothing else on the page.
  describe("the elapsed mark on a running phase", () => {
    const started = "2026-08-23T11:58:00Z";

    test("a tick advances the mark's own text (criterion 4)", () => {
      const h = fresh();
      h.visibility("visible");
      h.elapsed.push({ dataset: { elapsed: started }, textContent: "2m00s" });
      h.ticks.forEach((t) => t());
      expect(h.elapsed[0]!.textContent).toBe("2m 00s");
      h.clock.at += 61_000;
      h.ticks.forEach((t) => t());
      expect(h.elapsed[0]!.textContent).toBe("3m 01s");
    });

    // The requirement in full: nothing else on the page has changed —
    // no "changed" event, no row swap, no request at all.
    test("it advances with no server round trip of any kind (criterion 4)", () => {
      const h = fresh();
      h.visibility("visible");
      h.elapsed.push({ dataset: { elapsed: started }, textContent: "" });
      const before = h.requests.length;
      h.clock.at += 30_000;
      h.ticks.forEach((t) => t());
      expect(h.elapsed[0]!.textContent).toBe("2m 30s");
      expect(h.requests).toHaveLength(before);
      expect(h.live()!.listeners.changed).toBeDefined();
    });

    // The marks are looked up fresh on every tick, so a row swapped in
    // by the server is counted by the same timer with nothing rebound.
    test("a mark that arrives after the timer started is counted too", () => {
      const h = fresh();
      h.visibility("visible");
      h.ticks.forEach((t) => t());
      h.elapsed.push({ dataset: { elapsed: started }, textContent: "" });
      h.clock.at += 120_000;
      h.ticks.forEach((t) => t());
      expect(h.elapsed[0]!.textContent).toBe("4m 00s");
    });

    // The page words a duration in its own copy of the rule, because
    // this file can neither import nor export anything — the server
    // transpiles it into an inline <script>. Two copies of one rule is
    // the shape this repo pins rather than trusts: the moment they
    // disagree, a phase changes its wording the first time the clock
    // ticks over the figure the server drew.
    test("the page words a duration exactly as the server does", () => {
      const h = fresh();
      h.visibility("visible");
      const mark = { dataset: { elapsed: started }, textContent: "" };
      h.elapsed.push(mark);
      const base = Date.parse(started);
      for (const secs of [0, 1, 45, 59, 60, 61, 125, 3599, 3600, 3661, 7325, 86_400]) {
        h.clock.at = base + secs * 1000;
        h.ticks.forEach((t) => t());
        expect(mark.textContent).toBe(durationLabel(secs * 1000));
      }
    });

    // A genuinely positive span must never round down to "0s" — that
    // reads as "nothing recorded", indistinguishable from a phase the
    // queue never measured at all (spec 410, REQ-5).
    test("a sub-second span never rounds down to 0s, on either side of the hand-paired pair", () => {
      const h = fresh();
      h.visibility("visible");
      const mark = { dataset: { elapsed: started }, textContent: "" };
      h.elapsed.push(mark);
      h.clock.at = Date.parse(started) + 400;
      h.ticks.forEach((t) => t());
      expect(mark.textContent).toBe("1s");
      expect(mark.textContent).toBe(durationLabel(400));
    });

    // A mark whose stamp says nothing is left exactly as the server
    // drew it, rather than being overwritten with "NaN".
    test("an unreadable stamp is left alone", () => {
      const h = fresh();
      h.visibility("visible");
      h.elapsed.push({ dataset: { elapsed: "not a date" }, textContent: "–" });
      h.ticks.forEach((t) => t());
      expect(h.elapsed[0]!.textContent).toBe("–");
    });
  });

  test("a visible page opens one connection to the event stream", () => {
    const h = fresh();
    h.visibility("visible");
    expect(h.sources).toHaveLength(1);
    expect(h.sources[0]!.url).toContain("/api/queue/events");
  });

  // The address bar carries the token on the first load of a bookmarked
  // page, and `EventSource` has no other way to send one — it cannot set
  // a header, and the cookie is not there yet.
  test("the connection carries the page's own query string", () => {
    const h = harness(() => ({ ok: true }), "actionform", "?token=abc&state=active");
    h.visibility("visible");
    expect(h.sources[0]!.url).toBe("/api/queue/events?token=abc&state=active");
  });

  // Criterion 1, said the only way it can be said: with the connection
  // open and nobody sending anything, the page does not fetch rows.
  test("an idle connected page fetches nothing and redraws nothing (criterion 1)", async () => {
    const h = fresh();
    h.visibility("visible");
    await flush();
    expect(rowFetches(h)).toHaveLength(0);
    expect(h.rows.innerHTML).toBe("");
  });

  test("a `changed` event redraws the rows (criterion 2)", async () => {
    const h = fresh();
    h.visibility("visible");
    h.live()!.emit("changed");
    await flush();
    expect(rowFetches(h)).toHaveLength(1);
    expect(h.rows.innerHTML).toBe("<tr>fresh</tr>");
  });

  // `open` fires on the first connect AND on every reconnect the
  // browser makes on its own — after a dropped network, after the
  // server was restarted under the page. Resyncing there is what makes
  // criteria 4 and 5 self-healing without anyone reloading.
  test("`open` resyncs, so a reconnect picks up what was missed", async () => {
    const h = fresh();
    h.visibility("visible");
    h.live()!.emit("open");
    await flush();
    expect(rowFetches(h)).toHaveLength(1);

    // The same connection object, opened again: what the browser does
    // after it has retried by itself.
    h.live()!.emit("open");
    await flush();
    expect(rowFetches(h)).toHaveLength(2);
  });

  // The guard the five-second tick had, for the reason it had it: the
  // server still shows the OLD state until the press answers, so a swap
  // in that window puts an untouched button back over the "cancelling…"
  // the press just drew.
  test("a `changed` event during a press does not swap the rows (criterion 6)", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const h = harness((url) =>
      url.includes("/cancel") ? { ok: true, body: OK_ACTION, hold: held } : { ok: true },
    );
    h.visibility("visible");
    const pressed = h.submit();
    await Promise.resolve();
    h.live()!.emit("changed");
    await flush();
    expect(rowFetches(h)).toHaveLength(0);
    expect(h.button.classList.contains("busy")).toBe(true);
    release();
    await pressed;
    // The press's own follow-up swap is what redraws the row.
    expect(rowFetches(h)).toHaveLength(1);
    // And a push after it is answered again.
    h.live()!.emit("changed");
    await flush();
    expect(rowFetches(h)).toHaveLength(2);
  });

  // Nobody is reading a hidden tab, and the mini has better things to do
  // than hold a socket for a closed laptop — the same reason the timer
  // used to skip while hidden, applied to the connection itself.
  test("a hidden tab holds no connection and fetches nothing (criterion 7)", async () => {
    const h = fresh();
    h.visibility("visible");
    const first = h.live()!;
    h.visibility("hidden");
    expect(first.closed).toBe(true);
    expect(h.live()).toBeNull();
    await flush();
    expect(rowFetches(h)).toHaveLength(0);
  });

  test("a page that loads hidden never opens one", () => {
    const h = fresh();
    expect(h.sources).toHaveLength(0);
  });

  test("becoming visible again opens a fresh connection and resyncs (criterion 8)", async () => {
    const h = fresh();
    h.visibility("visible");
    h.visibility("hidden");
    h.visibility("visible");
    expect(h.sources).toHaveLength(2);
    expect(h.live()).not.toBeNull();
    // The resync is the `open` the fresh connection reports.
    h.live()!.emit("open");
    await flush();
    expect(rowFetches(h)).toHaveLength(1);
    expect(h.rows.innerHTML).toBe("<tr>fresh</tr>");
  });

  test("a visible page told it is visible again does not stack connections", () => {
    const h = fresh();
    h.visibility("visible");
    h.visibility("visible");
    expect(h.sources).toHaveLength(1);
  });
});

// `?live=0` leaves the page exactly as the server drew it. It stopped
// the five-second timer when there was one; it declines the connection
// now — the same promise against a different mechanism, and the whole
// point of it is that the browser's own tools can be used on a page
// that holds still.
describe("?live=0 declines the live connection", () => {
  test("an ordinary load connects", () => {
    const h = harness(() => ({ ok: true }));
    h.visibility("visible");
    expect(h.sources).toHaveLength(1);
  });

  test("with live=0 nothing is opened", () => {
    const h = harness(() => ({ ok: true }), "actionform", "?live=0");
    h.visibility("visible");
    expect(h.sources).toEqual([]);
  });

  // Asked on every connect, not only the first: a tab hidden and shown
  // again comes back through the same door.
  test("it still holds after the tab is hidden and shown again", () => {
    const h = harness(() => ({ ok: true }), "actionform", "?live=0");
    h.visibility("visible");
    h.visibility("hidden");
    h.visibility("visible");
    expect(h.sources).toEqual([]);
  });

  // Only that exact value: anything else is an ordinary page.
  test("any other query string connects as usual", () => {
    for (const search of ["?live=1", "?sort=spec", "?live=0x"]) {
      const h = harness(() => ({ ok: true }), "actionform", search);
      h.visibility("visible");
      expect(h.sources.length, search).toBe(1);
    }
  });
});

// --- spec 204: a redraw never takes a press with it -------------------------
//
// Reported 2026-08-23: come back to the tab, click a row, and nothing
// opens — the third press works. Coming back reconnects, the reconnect
// redraws, and the redraw used to replace every `<tr>` in `#jobrows` in
// one step. A browser only synthesizes `click` when `mousedown` and
// `mouseup` land on the SAME element, so a row torn out between the two
// swallows the press whole.
//
// What is asserted here is therefore node identity, not markup: a row
// the redraw had no reason to touch must be the same object afterwards.
// That is the fix, and everything else about it is scaffolding.
describe("a redraw touches only the specs that changed (spec 204)", () => {
  /** The shape the server actually sends: a filter bar, one table, and
   *  one `<tr class="spechead" id="spec-...">` per spec with its own
   *  rows beneath it. */
  const page = (...groups: string[]): string =>
    `<div class="row"></div><div class="tablewrap"><table class="list"><thead></thead><tbody>` +
    groups.join("") +
    `</tbody></table></div>`;

  const group = (key: string, state: string): string =>
    `<tr class="spechead open" id="spec-${key}" data-folder="${key.split("/")[1]}"><td>${key}</td></tr>` +
    `<tr class="subrow" data-of="${key}"><td>${state}</td></tr>`;

  const A = "aide/204-coming-back";
  const B = "aide/203-the-projects-page";

  /** A page whose row fetches answer with each text in turn, the last
   *  one repeating for good. */
  const pages = (...texts: string[]) => {
    let at = 0;
    return harness((url) =>
      url.includes("rows=1") ? { ok: true, text: texts[Math.min(at++, texts.length - 1)]! } : { ok: true },
    );
  };

  /** The tab becoming visible and its connection opening — the first
   *  swap, which is what establishes what is on screen. */
  const settle = async (h: ReturnType<typeof harness>) => {
    h.visibility("visible");
    h.live()!.emit("open");
    await flush();
  };

  test("an unchanged spec keeps its own row nodes across a redraw (criteria 1, 3)", async () => {
    const same = page(group(A, "queued"), group(B, "queued"));
    const h = pages(same, same);
    await settle(h);
    const head = h.rowFor(`spec-${A}`);
    const sub = head!.nextElementSibling;
    expect(head).not.toBeNull();

    h.live()!.emit("open");
    await flush();

    // The same objects, not merely the same markup: `toBe`, never
    // `toEqual`. A reader pressing this row between `mousedown` and
    // `mouseup` is pressing something that is still there.
    expect(h.rowFor(`spec-${A}`)).toBe(head);
    expect(h.rowFor(`spec-${A}`)!.nextElementSibling).toBe(sub);
    expect(h.rowFor(`spec-${B}`)).not.toBeNull();
  });

  test("a spec whose state moved IS replaced, and no other is (criterion 2)", async () => {
    const h = pages(
      page(group(A, "queued"), group(B, "queued")),
      page(group(A, "running"), group(B, "queued")),
    );
    await settle(h);
    const moved = h.rowFor(`spec-${A}`);
    const still = h.rowFor(`spec-${B}`);

    h.live()!.emit("open");
    await flush();

    expect(h.rowFor(`spec-${A}`)).not.toBe(moved);
    expect(h.rows.innerHTML).toContain("running");
    // The other spec had no reason to move and did not.
    expect(h.rowFor(`spec-${B}`)).toBe(still);
  });

  test("what the diff leaves behind is what the server sent (criterion 5)", async () => {
    // An hour on a hidden tab: the queue moved several times and the
    // page saw none of it, because a hidden tab holds no connection.
    // One reconnect has to be enough to catch up on all of it.
    const end = page(group(A, "done"), group(B, "running"));
    const h = pages(page(group(A, "queued"), group(B, "queued")), end);
    await settle(h);

    h.live()!.emit("open");
    await flush();

    expect(h.rows.innerHTML).toBe(end);
  });

  test("a spec that appeared while the tab was hidden is drawn in (criterion 4)", async () => {
    const h = pages(page(group(A, "queued")), page(group(A, "queued"), group(B, "queued")));
    await settle(h);
    const kept = h.rowFor(`spec-${A}`);

    h.live()!.emit("open");
    await flush();

    expect(h.rowIds()).toEqual([`spec-${A}`, "", `spec-${B}`, ""]);
    expect(h.rowFor(`spec-${A}`)).toBe(kept);
  });

  test("a spec that went away takes its own rows and no others", async () => {
    const h = pages(page(group(A, "queued"), group(B, "queued")), page(group(B, "queued")));
    await settle(h);
    const kept = h.rowFor(`spec-${B}`);

    h.live()!.emit("open");
    await flush();

    expect(h.rowFor(`spec-${A}`)).toBeNull();
    expect(h.rowFor(`spec-${B}`)).toBe(kept);
  });

  // The mitigation the risk analysis asks for: markup the split cannot
  // account for row by row is redrawn wholesale, exactly as it was
  // before this spec. Failing open to shipped behaviour beats a clever
  // diff that might be wrong.
  test("markup with no keyed groups falls back to the wholesale replace", async () => {
    const empty = `<div class="tablewrap"><table class="list"><tbody><tr><td class="empty">No spec.</td></tr></tbody></table></div>`;
    const h = pages(page(group(A, "queued")), empty, page(group(A, "queued")));
    await settle(h);

    h.live()!.emit("open");
    await flush();
    expect(h.rows.innerHTML).toBe(empty);

    // And back again, from a state the diff has no memory of.
    h.live()!.emit("open");
    await flush();
    expect(h.rows.innerHTML).toBe(page(group(A, "queued")));
  });

  // --- spec 226: the refresh does not throw the reader back to the top ---
  //
  // With the 25-row cap gone the list is as long as the archive is, and
  // it scrolls in a box of its own. A poll that lands while somebody is
  // reading halfway down must leave them there.
  //
  // The wholesale replace is the path that matters, and it is not a
  // rare one: `applyGroupDiff` declines whenever anything OUTSIDE the
  // rows differs, and a chip's count changing — a job starting,
  // finishing or being cancelled — is exactly that. It builds the
  // wrapper afresh, so a fix that only rode the keyed-diff path would
  // look right in a quiet minute and reset the scroll the next time
  // anything ran.
  describe("the list's scroll position survives a redraw (spec 226)", () => {
    /** The same page with one chip count changed — markup outside the
     *  rows, which is what makes `applyGroupDiff` decline. */
    const withCount = (n: number, ...groups: string[]): string =>
      `<div class="row"><a>Active (${n})</a></div><div class="tablewrap">` +
      `<table class="list"><thead></thead><tbody>${groups.join("")}</tbody></table></div>`;

    test("a wholesale replace puts it back where it was", async () => {
      const h = pages(withCount(1, group(A, "queued")), withCount(2, group(A, "running")));
      await settle(h);
      h.wrap().scrollTop = 420;

      h.live()!.emit("open");
      await flush();

      // The fallback fired — the filter bar differs, so the diff
      // declined — and the wrapper is a different object than the one
      // that was scrolled.
      expect(h.rows.innerHTML).toContain("Active (2)");
      expect(h.wrap().scrollTop).toBe(420);
    });

    test("and the keyed diff, which never touches the box, leaves it alone", async () => {
      const h = pages(withCount(1, group(A, "queued")), withCount(1, group(A, "running")));
      await settle(h);
      const box = h.wrap();
      box.scrollTop = 137;

      h.live()!.emit("open");
      await flush();

      expect(h.wrap()).toBe(box);
      expect(h.wrap().scrollTop).toBe(137);
    });
  });
});
