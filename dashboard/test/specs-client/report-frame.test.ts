// Spec 495, criterion 8: the page script that mirrors the theme into a
// report's frame and sizes the frame to its content. Fake documents, no
// browser: the real rendering is the e2e spec's.
import { describe, expect, test } from "bun:test";
import { bindReportFrame, type ReportFrameEnv } from "../../src/specs-client/report-frame.ts";

interface Listener { type: string; fn: () => void }

function fakeFrame(o: { readyState: string; height: number }) {
  const attrs = new Map<string, string>();
  const listeners: Listener[] = [];
  const documentElement = {
    scrollHeight: o.height,
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    removeAttribute: (n: string) => void attrs.delete(n),
    getAttribute: (n: string) => attrs.get(n) ?? null,
  };
  const frame = {
    style: { height: "" },
    contentDocument: { readyState: o.readyState, documentElement },
    addEventListener: (type: string, fn: () => void) => void listeners.push({ type, fn }),
  };
  return { frame: frame as unknown as HTMLIFrameElement, attrs, documentElement, fire: (type: string) => listeners.filter((l) => l.type === type).forEach((l) => l.fn()) };
}

function fakeEnv(theme: string | null) {
  const page = { theme };
  const mutation: { fn: () => void }[] = [];
  const resize: { fn: () => void; target?: unknown }[] = [];
  const windowListeners: (() => void)[] = [];
  const env: ReportFrameEnv = {
    page: { documentElement: { getAttribute: (n: string) => (n === "data-theme" ? page.theme : null) } } as unknown as Document,
    MutationObserverCtor: class { constructor(fn: () => void) { mutation.push({ fn }); } observe() {} disconnect() {} } as unknown as typeof MutationObserver,
    ResizeObserverCtor: class {
      entry: { fn: () => void; target?: unknown };
      constructor(fn: () => void) { this.entry = { fn }; resize.push(this.entry); }
      observe(t: unknown) { this.entry.target = t; }
      disconnect() {}
    } as unknown as typeof ResizeObserver,
    win: { addEventListener: (_t: string, fn: () => void) => void windowListeners.push(fn) } as unknown as Window,
  };
  return { env, page, mutation, resize, windowListeners };
}

describe("bindReportFrame", () => {
  test("copies the page's theme into a frame whose document is already complete, and sizes it", () => {
    const f = fakeFrame({ readyState: "complete", height: 412 });
    const e = fakeEnv("dark");
    bindReportFrame(f.frame, e.env);
    expect(f.attrs.get("data-theme")).toBe("dark");
    expect(f.frame.style.height).toBe("412px");
  });

  test("waits for the load event when the document is still loading", () => {
    const f = fakeFrame({ readyState: "loading", height: 300 });
    const e = fakeEnv("light");
    bindReportFrame(f.frame, e.env);
    expect(f.attrs.has("data-theme")).toBe(false);
    f.fire("load");
    expect(f.attrs.get("data-theme")).toBe("light");
    expect(f.frame.style.height).toBe("300px");
  });

  test("removes the frame's attribute when the page has none (Auto)", () => {
    const f = fakeFrame({ readyState: "complete", height: 100 });
    f.attrs.set("data-theme", "dark");
    bindReportFrame(f.frame, fakeEnv(null).env);
    expect(f.attrs.has("data-theme")).toBe(false);
  });

  test("follows a later change of the page's attribute", () => {
    const f = fakeFrame({ readyState: "complete", height: 100 });
    const e = fakeEnv("light");
    bindReportFrame(f.frame, e.env);
    e.page.theme = "dark";
    e.mutation.forEach((m) => m.fn());
    expect(f.attrs.get("data-theme")).toBe("dark");
  });

  test("sizes the frame again when its content or the window resizes", () => {
    const f = fakeFrame({ readyState: "complete", height: 100 });
    const e = fakeEnv("light");
    bindReportFrame(f.frame, e.env);
    expect(e.resize.some((r) => r.target === f.documentElement)).toBe(true);
    f.documentElement.scrollHeight = 640;
    e.resize.forEach((r) => r.fn());
    expect(f.frame.style.height).toBe("640px");
    f.documentElement.scrollHeight = 700;
    e.windowListeners.forEach((fn) => fn());
    expect(f.frame.style.height).toBe("700px");
  });
});
