// The check the Deploy tab makes when it is opened
// (`specs-client/deploy/origin-check.ts`), on the server's own markup in
// happy-dom, with the requests handed in.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderProjectPage, type ProjectView } from "../../../src/render";
import { bindDeployForms } from "../../../src/specs-client/deploy";
import { startOriginCheck, type OriginCheckIo } from "../../../src/specs-client/deploy/origin-check.ts";
import type { DeployIo } from "../../../src/specs-client/deploy/run.ts";

/** The project page as the server draws it on the Deploy tab. An
 *  `undefined` drift is a project with no install command. */
const projectPage = (drift?: { behind: number | null; checkedAt: number }): string => {
  const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
  return renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-09-20T00:00:00Z", [], {
    worktreeLinkCandidates: [],
    editingGroup: null,
    tab: "deploy",
    ...(drift ? { drift } : {}),
  });
};

const CHECKED_AT = Date.parse("2026-09-20T00:00:00Z");
const LEVEL = projectPage({ behind: 0, checkedAt: CHECKED_AT });
const BEHIND = projectPage({ behind: 1, checkedAt: CHECKED_AT });

/** The page `html` loaded in a window, and what a test reads off it. */
function load(html: string) {
  const window = new Window();
  window.document.write(html);
  const doc = window.document as unknown as Document;
  const section = (): HTMLElement | null => doc.querySelector("[data-origin-check]");
  const button = (): HTMLButtonElement | null => doc.querySelector("form.deployform button") as HTMLButtonElement | null;
  return { window, doc, section, button, text: (): string => section()?.textContent ?? "" };
}

/** An io that records what it was asked, and answers when told to. */
function fakeIo(over: Partial<OriginCheckIo> = {}, answers: { check?: boolean; page?: string | null } = {}) {
  const asked = { check: 0, page: 0 };
  const io: OriginCheckIo = {
    check: async () => {
      asked.check += 1;
      return answers.check ?? true;
    },
    page: async () => {
      asked.page += 1;
      return answers.page === undefined ? BEHIND : answers.page;
    },
    ...over,
  };
  return { io, asked };
}

/** Lets the check's two requests and the redraw run. */
const settle = (): Promise<void> => Bun.sleep(20);

/** A held request, answered when the test says so. */
function held<T>() {
  let answer: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => (answer = resolve));
  return { promise, answer };
}

describe("the check made when the Deploy tab is opened", () => {
  test("it posts once at load, to the address the section carries (AC-1)", async () => {
    const { doc, section } = load(LEVEL);
    const { io, asked } = fakeIo();
    let handedTo = null as HTMLElement | null;
    startOriginCheck(doc, (s) => {
        handedTo = s;
        return io;
      }, () => {});
    expect(asked.check).toBe(1);
    expect(handedTo).toBe(section());
    expect(section()!.dataset.originCheck).toBe("/api/queue/projects/aide/drift");
    await settle();
    expect(asked.check).toBe(1);
  });

  test("a project with no install command has no section to check, and asks nothing (AC-1)", () => {
    const { doc, section } = load(projectPage());
    expect(section()).toBeNull();
    let made = 0;
    startOriginCheck(doc, () => {
        made++;
        return fakeIo().io;
      }, () => {});
    expect(made).toBe(0);
  });

  test("a document with no such section is left alone, as the page-script tests' stand-in is (AC-1)", () => {
    const doc = { querySelector: () => null } as unknown as Document;
    expect(() => startOriginCheck(doc, () => fakeIo().io, () => {})).not.toThrow();
  });

  test("when the check answers, the sentence and the button come from the fresh page, in place (AC-2)", async () => {
    const { doc, section, button, text } = load(LEVEL);
    expect(text()).toContain("This checkout matches origin");
    expect(button()!.disabled).toBe(true);
    const before = section();
    startOriginCheck(doc, () => fakeIo().io, () => {});
    await settle();
    expect(section()).not.toBe(before);
    expect(text()).toContain("1 commit behind origin");
    expect(button()!.disabled).toBe(false);
  });

  test("while the check has not answered, the section is as it was drawn and the page is not read again (AC-3)", async () => {
    const { doc, section, text } = load(LEVEL);
    const before = section();
    const html = before!.outerHTML;
    const gate = held<boolean>();
    const { io, asked } = fakeIo({ check: () => gate.promise });
    startOriginCheck(doc, () => io, () => {});
    await settle();
    expect(section()).toBe(before);
    expect(section()!.outerHTML).toBe(html);
    expect(text()).toContain("This checkout matches origin");
    expect(asked.page).toBe(0);
  });

  test("the redrawn Deploy form is taken by the Deploy script, not posted to the page (AC-2)", async () => {
    const { window, doc, section } = load(LEVEL);
    const io: DeployIo = {
      post: async () => ({ ok: false, error: "stopped here" }),
      version: async () => ({ startedAt: "old" }),
      sleep: async () => {},
      reload: () => {},
    };
    startOriginCheck(doc, () => fakeIo().io, (root) => bindDeployForms(root, () => io));
    await settle();
    const form = section()!.querySelector("form.deployform") as unknown as HTMLFormElement;
    const event = new window.Event("submit", { cancelable: true });
    form.dispatchEvent(event as unknown as Event);
    expect(event.defaultPrevented).toBe(true);
    await settle();
  });

  test("a press before the check answers leaves the section as it is (AC-2)", async () => {
    const { window, doc, section } = load(LEVEL);
    const gate = held<boolean>();
    const { io } = fakeIo({ check: () => gate.promise });
    startOriginCheck(doc, () => io, () => {});
    const before = section();
    before!.dispatchEvent(new window.Event("submit", { bubbles: true }) as unknown as Event);
    gate.answer(true);
    await settle();
    expect(section()).toBe(before);
  });

  test("an open dialog when the check answers leaves the section as it is (AC-2)", async () => {
    const { window, doc, section } = load(LEVEL);
    const gate = held<boolean>();
    const { io } = fakeIo({ check: () => gate.promise });
    startOriginCheck(doc, () => io, () => {});
    const before = section();
    const dialog = window.document.createElement("dialog");
    dialog.setAttribute("open", "");
    window.document.body.append(dialog);
    gate.answer(true);
    await settle();
    expect(section()).toBe(before);
  });
});

describe("a check that did not answer changes nothing (AC-4)", () => {
  const unchanged = async (io: OriginCheckIo): Promise<void> => {
    const { doc, section } = load(LEVEL);
    const before = section();
    const html = before!.outerHTML;
    startOriginCheck(doc, () => io, () => {});
    await settle();
    expect(section()).toBe(before);
    expect(section()!.outerHTML).toBe(html);
  };

  test("a 400 answer: the section stays and the page is not read", async () => {
    const { io, asked } = fakeIo({}, { check: false });
    await unchanged(io);
    expect(asked.page).toBe(0);
  });

  test("a request that throws: the section stays and the page is not read", async () => {
    const { io, asked } = fakeIo({
      check: async () => {
        throw new Error("network down");
      },
    });
    await unchanged(io);
    expect(asked.page).toBe(0);
  });

  test("a page that cannot be read: the section stays", async () => {
    await unchanged(fakeIo({}, { page: null }).io);
    await unchanged(
      fakeIo({
        page: async () => {
          throw new Error("network down");
        },
      }).io,
    );
  });

  test("a page without a Deploy section: the section stays", async () => {
    await unchanged(fakeIo({}, { page: projectPage() }).io);
  });
});
