import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { bindReportFrame } from "../../src/specs-client/report-frame.ts";

test("the report frame follows the page theme (AC-4)", () => {
  const window = new Window();
  const frameWindow = new Window();
  const frame = window.document.createElement("iframe") as unknown as HTMLIFrameElement;
  Object.defineProperty(frame, "contentDocument", { value: frameWindow.document });
  window.document.documentElement.dataset.palette = "iris";
  const stop = bindReportFrame(frame as unknown as HTMLIFrameElement, {
    page: window.document as unknown as Document,
    MutationObserverCtor: window.MutationObserver as unknown as typeof MutationObserver,
    ResizeObserverCtor: window.ResizeObserver as unknown as typeof ResizeObserver,
    win: window as unknown as globalThis.Window,
  });
  frame.dispatchEvent(new window.Event("load") as unknown as Event);
  expect(frame.contentDocument?.documentElement.dataset.palette).toBe("iris");
  stop();
});
