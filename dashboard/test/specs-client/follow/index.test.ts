// The page script's following of a page in place: when it asks, what it
// pins in the address, and what it leaves alone when the answer comes back.
// Node identity proves a part was left alone, never markup.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createFollow, type FollowEnv } from "../../../src/specs-client/follow";

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

const MARKER = (attrs = 'data-tab="steps" data-running="1" data-phases="aide/605-x:analyze"') => `<span hidden data-follow ${attrs}></span>`;
const ROW = (cells: string) => `<tr><td>${cells}</td></tr>`;
const LOG = (text: string) => `<tr class="steplog"><td><div class="logbox"><div><pre class="specfile"><span class="muted">— AI —</span>\n${text}</pre></div></div></td></tr>`;
const PAGE = (marker: string, rows: string, head = "Running") =>
  `${marker}<div data-follow-part="head"><p>${head}</p></div>` +
  `<div data-follow-part="panel"><div class="tablewrap"><table><thead><tr><th>Step</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;

interface Reply { ok?: boolean; html: string; hold?: Promise<void> }

function setup(html: string, o: { search?: string; reply?: (url: string) => Reply } = {}) {
  const win = new Window();
  windows.push(win);
  win.document.write(`<body>${html}</body>`);
  const doc = win.document as unknown as Document;
  const loc = { pathname: "/jobs/j1", search: o.search ?? "" };
  const asked: string[] = [];
  const replaced: string[] = [];
  const clock = { at: 10_000 };
  const timers: { fn: () => void; ms: number }[] = [];
  const state: { busy: boolean; phases: number; reply: (url: string) => Reply } = {
    busy: false,
    phases: 0,
    reply: o.reply ?? (() => ({ html: "" })),
  };
  const env: FollowEnv = {
    doc,
    win: win as unknown as FollowEnv["win"],
    fetch: async (url) => {
      asked.push(url);
      const r = state.reply(url);
      if (r.hold) await r.hold;
      return { ok: r.ok ?? true, text: async () => r.html };
    },
    now: () => clock.at,
    setTimeout: (fn, ms) => void timers.push({ fn, ms }),
    location: loc,
    replaceState: (url) => {
      replaced.push(url);
      loc.search = new URL(url, "http://x").search;
    },
    busy: () => state.busy,
    phasesChanged: () => void state.phases++,
  };
  const follow = createFollow(env);
  const nodes = (): Element[] => [...doc.querySelectorAll("[data-follow-part] *")];
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { win, doc, follow, loc, asked, replaced, clock, timers, state, nodes, flush };
}

describe("a followed page whose parts are equal to the answer's keeps every node (AC-1)", () => {
  const rows = ROW("0 ok") + ROW("1 running") + LOG("line one");

  test("with the job still in flight (AC-1)", async () => {
    const t = setup(PAGE(MARKER(), rows));
    t.state.reply = () => ({ html: PAGE(MARKER(), rows) });
    const before = t.nodes();
    t.follow.request();
    await t.flush();
    expect(t.asked).toHaveLength(1);
    const after = t.nodes();
    expect(after).toHaveLength(before.length);
    after.forEach((n, i) => expect(n).toBe(before[i]!));
  });

  test("with the job done, when the answer carries no marker (AC-1)", async () => {
    const t = setup(PAGE(MARKER(), rows));
    t.state.reply = () => ({ html: PAGE("", rows) });
    const before = t.nodes();
    t.follow.request();
    await t.flush();
    const after = t.nodes();
    expect(after).toHaveLength(before.length);
    after.forEach((n, i) => expect(n).toBe(before[i]!));
  });
});

describe("the pacing of the asks (AC-2)", () => {
  test("five events while an ask is out give one more ask after it, never less than two seconds on (AC-2)", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const t = setup(PAGE(MARKER(), ROW("0")));
    t.state.reply = () => ({ html: PAGE(MARKER(), ROW("0")), hold: held });
    t.follow.request();
    for (let i = 0; i < 5; i++) t.follow.request();
    expect(t.asked).toHaveLength(1);
    release();
    await t.flush();
    // Out of the air, but not two seconds on: the next ask waits for its time.
    expect(t.asked).toHaveLength(1);
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0]!.ms).toBe(2000);
    t.clock.at += 2000;
    t.timers[0]!.fn();
    await t.flush();
    expect(t.asked).toHaveLength(2);
    t.clock.at += 5000;
    t.timers.length = 0;
    t.follow.request();
    await t.flush();
    expect(t.asked).toHaveLength(3);
  });
});

describe("what a longer log does to its table (AC-3)", () => {
  test("only the end is added: the head, the other rows and the log's earlier text are the same nodes (AC-3)", async () => {
    const old = ROW("0 ok") + ROW("1 running") + LOG("line one");
    const next = ROW("0 ok") + ROW("1 running") + LOG("line one\nline two");
    const t = setup(PAGE(MARKER(), old));
    t.state.reply = () => ({ html: PAGE(MARKER(), next) });
    const head = t.doc.querySelector("thead")!;
    const trs = [...t.doc.querySelectorAll("tbody > tr")];
    const pre = t.doc.querySelector("pre")!;
    const earlier = [...pre.childNodes];
    t.follow.request();
    await t.flush();
    expect(t.doc.querySelector("thead")).toBe(head);
    [...t.doc.querySelectorAll("tbody > tr")].forEach((tr, i) => expect(tr).toBe(trs[i]!));
    expect(t.doc.querySelector("pre")).toBe(pre);
    earlier.forEach((n, i) => expect(pre.childNodes[i]).toBe(n));
    expect(pre.textContent).toContain("line one\nline two");
    expect(pre.childNodes.length).toBeGreaterThan(earlier.length);
  });

  test("a change that is not a longer log replaces its row and no other (AC-3)", async () => {
    const old = ROW("0 ok") + ROW("1 running");
    const next = ROW("0 ok") + ROW("1 finished");
    const t = setup(PAGE(MARKER(), old));
    t.state.reply = () => ({ html: PAGE("", next) });
    const trs = [...t.doc.querySelectorAll("tbody > tr")];
    t.follow.request();
    await t.flush();
    const after = [...t.doc.querySelectorAll("tbody > tr")];
    expect(after[0]).toBe(trs[0]!);
    expect(after[1]).not.toBe(trs[1]!);
    expect(after[1]!.textContent).toContain("1 finished");
  });

  test("a row the answer adds is added, and one it drops is dropped (AC-3)", async () => {
    const t = setup(PAGE(MARKER(), ROW("0 ok") + ROW("1 running")));
    t.state.reply = () => ({ html: PAGE(MARKER(), ROW("0 ok") + ROW("1 ok") + ROW("2 running")) });
    t.follow.request();
    await t.flush();
    expect([...t.doc.querySelectorAll("tbody > tr")].map((tr) => tr.textContent)).toEqual(["0 ok", "1 ok", "2 running"]);
    t.clock.at += 5000;
    t.state.reply = () => ({ html: PAGE(MARKER(), ROW("0 ok")) });
    t.follow.request();
    await t.flush();
    expect([...t.doc.querySelectorAll("tbody > tr")].map((tr) => tr.textContent)).toEqual(["0 ok"]);
  });
});

describe("a row holding the reader's selection (AC-3)", () => {
  test("is left as it was until the selection is gone, and replaced then (AC-3)", async () => {
    const t = setup(PAGE(MARKER(), ROW("0 ok") + LOG("line one")));
    t.state.reply = () => ({ html: PAGE(MARKER(), ROW("0 ok") + LOG("rewritten")) });
    const log = t.doc.querySelector("tr.steplog")!;
    t.win.getSelection().selectAllChildren(t.doc.querySelector("pre") as never);
    t.follow.request();
    await t.flush();
    expect(t.doc.querySelector("tr.steplog")).toBe(log);
    expect(log.textContent).toContain("line one");

    t.win.getSelection().removeAllRanges();
    t.doc.dispatchEvent(new t.win.Event("selectionchange") as unknown as Event);
    await t.flush();
    expect(t.doc.querySelector("tr.steplog")).not.toBe(log);
    expect(t.doc.querySelector("tr.steplog")!.textContent).toContain("rewritten");
  });
});

describe("the address the asks pin (AC-3)", () => {
  test("a page with no tab and no step asks with the marker's, and the address holds both after (AC-3)", async () => {
    const t = setup(PAGE(MARKER('data-tab="steps" data-running="2"'), ROW("0")));
    t.state.reply = () => ({ html: PAGE(MARKER('data-tab="steps" data-running="2"'), ROW("0")) });
    t.follow.request();
    await t.flush();
    const url = new URL(t.asked[0]!, "http://x");
    expect(url.pathname).toBe("/jobs/j1");
    expect(url.searchParams.get("tab")).toBe("steps");
    expect(url.searchParams.get("step")).toBe("2");
    expect(url.searchParams.get("follow")).toBe("1");
    expect(new URLSearchParams(t.loc.search).get("tab")).toBe("steps");
    expect(new URLSearchParams(t.loc.search).get("step")).toBe("2");
    expect(new URLSearchParams(t.loc.search).has("follow")).toBe(false);
  });

  test("`live` is pinned to the index too, and a step the reader chose is kept (AC-3)", async () => {
    const live = setup(PAGE(MARKER('data-tab="steps" data-running="2"'), ROW("0")), { search: "?tab=steps&step=live" });
    live.follow.request();
    await live.flush();
    expect(new URLSearchParams(live.loc.search).get("step")).toBe("2");

    const chosen = setup(PAGE(MARKER('data-tab="steps" data-running="2"'), ROW("0")), { search: "?tab=steps&step=0" });
    chosen.follow.request();
    await chosen.flush();
    expect(new URL(chosen.asked[0]!, "http://x").searchParams.get("step")).toBe("0");
    expect(chosen.replaced).toEqual([]);
  });
});

describe("what the answer's marker does to the page's own (AC-2, AC-6)", () => {
  test("an answer with no marker removes the page's, and later asks stop (AC-6)", async () => {
    const t = setup(PAGE(MARKER(), ROW("0")));
    t.state.reply = () => ({ html: PAGE("", ROW("0 ok")) });
    t.follow.request();
    await t.flush();
    expect(t.doc.querySelector("[data-follow]")).toBeNull();
    t.clock.at += 5000;
    t.follow.request();
    await t.flush();
    expect(t.asked).toHaveLength(1);
  });

  test("an answer with a marker replaces the page's, and the stream is asked to look at its phases (AC-2)", async () => {
    const t = setup(PAGE(MARKER('data-tab="steps" data-running="1"'), ROW("0")));
    t.state.reply = () => ({ html: PAGE(MARKER('data-tab="steps" data-running="1" data-phases="aide/605-x:implement"'), ROW("0")) });
    expect(t.follow.phases()).toBe("");
    t.follow.request();
    await t.flush();
    expect(t.follow.phases()).toBe("aide/605-x:implement");
    expect(t.state.phases).toBe(1);
  });
});
