// A scheduled run's report sits in a sandboxed `srcdoc` frame (spec 495).
// The frame is its own document, so two things the page owns have to be
// carried in: the theme the reader chose, and the height the report needs.

/** What the binding reads from the browser, so a test can hand it fakes. */
export interface ReportFrameEnv {
  page: Document;
  MutationObserverCtor: typeof MutationObserver;
  ResizeObserverCtor: typeof ResizeObserver;
  win: Window;
}

const browserEnv = (): ReportFrameEnv => ({
  page: document,
  MutationObserverCtor: MutationObserver,
  ResizeObserverCtor: ResizeObserver,
  win: window,
});

export function bindReportFrame(frame: HTMLIFrameElement, env: ReportFrameEnv = browserEnv()): void {
  let resizing: ResizeObserver | undefined;

  const mirrorTheme = (): void => {
    const root = frame.contentDocument?.documentElement;
    if (!root) return;
    const theme = env.page.documentElement.getAttribute("data-theme");
    // Auto is the ABSENCE of the attribute, so it is removed, not blanked.
    if (theme) root.setAttribute("data-theme", theme);
    else root.removeAttribute("data-theme");
  };

  const fitHeight = (): void => {
    const root = frame.contentDocument?.documentElement;
    if (root) frame.style.height = `${root.scrollHeight}px`;
  };

  // The frame first holds an empty about:blank document and its `load` may
  // already have fired when this runs: act on a complete document AND on
  // every `load`.
  const adopt = (): void => {
    const root = frame.contentDocument?.documentElement;
    if (!root) return;
    mirrorTheme();
    fitHeight();
    resizing?.disconnect();
    resizing = new env.ResizeObserverCtor(fitHeight);
    resizing.observe(root);
  };

  frame.addEventListener("load", adopt);
  if (frame.contentDocument?.readyState === "complete") adopt();
  new env.MutationObserverCtor(mirrorTheme).observe(env.page.documentElement, { attributeFilter: ["data-theme"] });
  env.win.addEventListener("resize", fitHeight);
}
