// POST /projects/<name>/hide: a project hidden or shown on its Config tab,
// kept beside the board's checkouts and never in the project's repository;
// the lists that leave a hidden project out, and the pages that still open.
import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "../../../helpers/queue-server.ts";
import { hiddenOf, setHidden } from "../../../../src/project/project-admin/hidden.ts";
import { QueueStore, type QueueDefaults } from "../../../../src/queue/queue.ts";

const harness = queueHarness("aide-project-hide-route-");
const dirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const DONE_JOB = {
  id: "beta-done", project: "beta", specFolder: "01-first", steps: ["analyze"], stepIndex: 0, state: "done",
  timeoutSec: {}, permissionMode: {}, model: {}, results: [], createdAt: "2026-08-01T10:00:00Z",
  finishedAt: "2026-08-01T10:05:00Z",
};

/** A board with the projects `aide`, `beta` and `gamma`, `beta` a git
 *  repository with a finished job. */
function board(): { base: string; dir: string } {
  return harness.start({
    alsoProjects: ["beta", "gamma"],
    extra: { queueProjects: ["aide", "beta", "gamma"] },
    queueMirror: JSON.stringify([DONE_JOB]),
    before: (dir) => {
      const project = join(dir, "root", "beta");
      const git = (...args: string[]) => {
        const r = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: project });
        if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
      };
      git("init", "-q", "-b", "main");
      git("add", "-A");
      git("commit", "-qm", "files");
    },
  });
}

const hide = (base: string, name: string, hidden: string): Promise<Response> =>
  fetch(`${base}/projects/${name}/hide`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ hidden }),
  });

async function page(base: string, path: string): Promise<Document> {
  const window = new Window();
  window.document.body.innerHTML = await (await fetch(`${base}${path}`)).text();
  return window.document as unknown as Document;
}

const picker = async (base: string, name: string): Promise<string[]> =>
  [...(await page(base, `/projects/${name}?tab=config`)).querySelectorAll(".projectpicker .menupanel a > span:last-child")]
    .map((s) => s.textContent!);

const choice = async (base: string): Promise<string[]> =>
  [...(await page(base, "/new")).querySelectorAll('select[name="project"] option')]
    .map((o) => o.getAttribute("value")!).filter(Boolean);

/** Every list where a project is chosen, as the board draws them now. */
const lists = async (base: string) => ({
  picker: await picker(base, "aide"),
  choice: await choice(base),
});

describe("POST /projects/<name>/hide", () => {
  test("hiding keeps a file beside the checkouts, showing removes it, and a bad value is refused (AC-2, AC-10)", async () => {
    const { base, dir } = board();
    const res = await hide(base, "beta", "on");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(existsSync(join(dir, "owned", "beta", "hidden"))).toBe(true);
    expect((await hide(base, "beta", "off")).status).toBe(200);
    expect(existsSync(join(dir, "owned", "beta", "hidden"))).toBe(false);
    expect((await hide(base, "beta", "maybe")).status).toBe(400);
    expect((await hide(base, "nosuch", "on")).status).toBe(400);
    expect(existsSync(join(dir, "owned", "beta", "hidden"))).toBe(false);
  });
});

describe("a hidden project on the board", () => {
  test("the Config tab offers Hide, asking first, on a shown project and Show on a hidden one (AC-1)", async () => {
    const { base } = board();
    await hide(base, "beta", "on");
    const shown = await page(base, "/projects/aide?tab=config");
    const ask = shown.querySelector('form[action="/projects/aide/hide"] input[name="hidden"]');
    expect(ask?.getAttribute("value")).toBe("on");
    expect(ask?.closest("dialog")).not.toBeNull();
    const hidden = await page(base, "/projects/beta?tab=config");
    const show = hidden.querySelector('form[action="/projects/beta/hide"] input[name="hidden"]');
    expect(show?.getAttribute("value")).toBe("off");
    expect(show?.closest("dialog")).toBeNull();
  });

  test("is left out of the picker and the New spec form, and Show lists it again (AC-3, AC-9)", async () => {
    const { base } = board();
    const all = ["aide", "beta", "gamma"];
    expect(await lists(base)).toEqual({ picker: all, choice: all });
    await hide(base, "beta", "on");
    const without = ["aide", "gamma"];
    expect(await lists(base)).toEqual({ picker: without, choice: without });
    await hide(base, "beta", "off");
    expect(await lists(base)).toEqual({ picker: all, choice: all });
  });

  test("the Projects list draws it inside the Hidden fold, and Show takes it out (AC-4, AC-9)", async () => {
    const { base } = board();
    await hide(base, "beta", "on");
    const folded = async () =>
      [...(await page(base, "/projects")).querySelectorAll("details .cardrow[data-project]")].map((r) => r.getAttribute("data-project"));
    expect(await folded()).toEqual(["beta"]);
    await hide(base, "beta", "off");
    expect(await folded()).toEqual([]);
  });

  test("its spec and the spec's history still open, and the job stays on Jobs (AC-5)", async () => {
    const { base } = board();
    await hide(base, "beta", "on");
    expect((await fetch(`${base}/projects/beta`)).status).toBe(200);
    for (const path of ["/specs/beta/01-first", "/specs/beta/01-first?tab=status"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("01-first");
    }
    expect(await (await fetch(`${base}/?q=${encodeURIComponent("beta:01")}`)).text()).toContain('id="spec-beta/01-first"');
  });
});

describe("a job already in the queue when its project is hidden", () => {
  const DEFAULTS: QueueDefaults = { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } };

  test("the queued one and the running one each go on to done (AC-8)", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-hidden-queue-"));
    dirs.push(dir);
    const resolve = (project: string) =>
      project === "beta" ? { specFolders: ["01-first", "02-second"], hidden: hiddenOf(dir, [project]).has(project) } : null;
    const store = new QueueStore({ mirrorPath: join(dir, "queue.json"), defaults: DEFAULTS, resolve });
    const running = store.enqueue({ project: "beta", specFolder: "01-first", steps: ["analyze"] });
    const queued = store.enqueue({ project: "beta", specFolder: "02-second", steps: ["analyze"] });
    if (!running.ok || !queued.ok) throw new Error("not queued");
    expect(store.transition(running.job.id, "start").ok).toBe(true);
    setHidden(dir, "beta", true);
    expect(store.enqueue({ project: "beta", specFolder: "01-first", steps: ["implement"] }).ok).toBe(false);
    expect(store.transition(running.job.id, "step-succeeded-last").ok).toBe(true);
    expect(store.transition(queued.job.id, "start").ok).toBe(true);
    expect(store.transition(queued.job.id, "step-succeeded-last").ok).toBe(true);
    expect([store.get(running.job.id)?.state, store.get(queued.job.id)?.state]).toEqual(["done", "done"]);
  });
});
