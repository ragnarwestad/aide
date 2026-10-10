// The Add form's Test command placeholder follows the Git URL field: the
// server is asked what command the repository's root files point at, and
// the form keeps its drawn hint whenever there is no answer to show.
// Hand-built fakes and a fake `fetch`, as `schedule-actions.test.ts` does.
import { describe, expect, test } from "bun:test";
import { bindAddProjectForm } from "../../../src/specs-client/add-project";

const DRAWN = "optional — the project's own test command";
const ROUTE = "/api/queue/projects/test-command";

interface FakeInput {
  value: string;
  placeholder: string;
  addEventListener(type: string, listener: () => unknown): void;
}

/** A form holding the two inputs; `change(input)` runs the listeners an input has
 *  for `change` and resolves when the work they started is done. */
function fakeForm() {
  const listeners = new Map<FakeInput, (() => unknown)[]>();
  const input = (placeholder: string): FakeInput => {
    const made: FakeInput = {
      value: "",
      placeholder,
      addEventListener: (type, listener) => {
        if (type === "change") listeners.set(made, [...(listeners.get(made) ?? []), listener]);
      },
    };
    return made;
  };
  const gitUrl = input("cloned under the projects root");
  const testCmd = input(DRAWN);
  const form = {
    querySelector: (selector: string) => (selector.includes("gitUrl") ? gitUrl : selector.includes("testCmd") ? testCmd : null),
  } as unknown as HTMLFormElement;
  const change = async (field: FakeInput): Promise<void> => {
    await Promise.all((listeners.get(field) ?? []).map((listener) => listener()));
  };
  return { form, gitUrl, testCmd, change };
}

const answering = (testCmd: string | null, calls: { url: string; body: unknown }[] = []): typeof fetch =>
  (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return { ok: true, json: async () => ({ ok: true, testCmd }) } as Response;
  }) as unknown as typeof fetch;

describe("the Add form's Test command placeholder (AC-1)", () => {
  test("a command the server answers becomes the placeholder (AC-1)", async () => {
    const f = fakeForm();
    const calls: { url: string; body: unknown }[] = [];
    bindAddProjectForm(f.form, answering("npm test", calls));
    f.gitUrl.value = " https://example.com/p.git ";
    await f.change(f.gitUrl);
    expect(calls).toEqual([{ url: ROUTE, body: { gitUrl: "https://example.com/p.git" } }]);
    expect(f.testCmd.placeholder).toBe("npm test");
  });

  test("a null answer, or a failed request, leaves the drawn placeholder (AC-1)", async () => {
    const nothing = fakeForm();
    bindAddProjectForm(nothing.form, answering(null));
    nothing.gitUrl.value = "https://example.com/p.git";
    await nothing.change(nothing.gitUrl);
    expect(nothing.testCmd.placeholder).toBe(DRAWN);

    const failing = fakeForm();
    bindAddProjectForm(failing.form, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    failing.gitUrl.value = "https://example.com/p.git";
    await failing.change(failing.gitUrl);
    expect(failing.testCmd.placeholder).toBe(DRAWN);
  });

  test("a later address that gets no answer puts the drawn placeholder back (AC-1)", async () => {
    const f = fakeForm();
    let next: string | null = "npm test";
    bindAddProjectForm(f.form, (async () => ({ ok: true, json: async () => ({ ok: true, testCmd: next }) }) as Response) as unknown as typeof fetch);
    f.gitUrl.value = "https://example.com/a.git";
    await f.change(f.gitUrl);
    expect(f.testCmd.placeholder).toBe("npm test");
    next = null;
    f.gitUrl.value = "https://example.com/b.git";
    await f.change(f.gitUrl);
    expect(f.testCmd.placeholder).toBe(DRAWN);
  });

  test("an answer about an address the field no longer holds is ignored (AC-1)", async () => {
    const f = fakeForm();
    let release: (cmd: string | null) => void = () => {};
    const slow = new Promise<string | null>((resolve) => { release = resolve; });
    bindAddProjectForm(f.form, (async () => ({ ok: true, json: async () => ({ ok: true, testCmd: await slow }) }) as Response) as unknown as typeof fetch);
    f.gitUrl.value = "https://example.com/a.git";
    const asking = f.change(f.gitUrl);
    f.gitUrl.value = "https://example.com/b.git";
    release("npm test");
    await asking;
    expect(f.testCmd.placeholder).toBe(DRAWN);
  });

  test("an emptied field puts the drawn placeholder back and asks nothing (AC-1)", async () => {
    const f = fakeForm();
    const calls: { url: string; body: unknown }[] = [];
    bindAddProjectForm(f.form, answering("npm test", calls));
    f.gitUrl.value = "https://example.com/p.git";
    await f.change(f.gitUrl);
    expect(f.testCmd.placeholder).toBe("npm test");
    f.gitUrl.value = "  ";
    await f.change(f.gitUrl);
    expect(f.testCmd.placeholder).toBe(DRAWN);
    expect(calls).toHaveLength(1);
  });

  test("a form without the two inputs is left alone (AC-1)", () => {
    const form = { querySelector: () => null } as unknown as HTMLFormElement;
    expect(() => bindAddProjectForm(form, answering(null))).not.toThrow();
  });
});
