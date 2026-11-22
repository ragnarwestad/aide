// POST /projects/<name>/pin: a project pinned or unpinned on its Config tab,
// kept beside the board's checkouts and never in the project's repository;
// and the lists that draw a pinned project first.
import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { queueHarness } from "../../../helpers/queue-server.ts";

const harness = queueHarness("aide-project-pin-route-");
afterEach(() => harness.cleanup());

/** A board with the projects `aide`, `beta` and `gamma`, `gamma` a git repository. */
function board(): { base: string; dir: string } {
  return harness.start({
    alsoProjects: ["beta", "gamma"],
    extra: { queueProjects: ["aide", "beta", "gamma"] },
    before: (dir) => {
      const project = join(dir, "root", "gamma");
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

const pin = (base: string, name: string, pinned: string): Promise<Response> =>
  fetch(`${base}/projects/${name}/pin`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pinned }),
  });

async function page(base: string, path: string): Promise<Document> {
  const window = new Window();
  window.document.body.innerHTML = await (await fetch(`${base}${path}`)).text();
  return window.document as unknown as Document;
}

const listed = async (base: string): Promise<string[]> =>
  [...(await page(base, "/projects")).querySelectorAll(".cardrow[data-project]")].map((r) => r.getAttribute("data-project")!);

/** The projects a Project filter offers, after its All entry. */
const filtered = async (base: string, path: string): Promise<string[]> =>
  [...(await page(base, path)).querySelectorAll("#project-filter .menupanel a")].slice(1).map((a) => a.textContent!.trim());

describe("POST /projects/<name>/pin", () => {
  test("pinning puts the project first on the Projects list, and unpinning puts it back (AC-2, AC-4)", async () => {
    const { base, dir } = board();
    expect(await listed(base)).toEqual(["aide", "beta", "gamma"]);
    const res = await pin(base, "gamma", "on");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(existsSync(join(dir, "owned", "gamma", "pinned"))).toBe(true);
    expect(await listed(base)).toEqual(["gamma", "aide", "beta"]);
    expect((await pin(base, "gamma", "off")).status).toBe(200);
    expect(existsSync(join(dir, "owned", "gamma", "pinned"))).toBe(false);
    expect(await listed(base)).toEqual(["aide", "beta", "gamma"]);
  });

  test("a project the board does not know, or a value other than on or off, is refused and writes nothing (AC-5)", async () => {
    const { base, dir } = board();
    const unknown = await pin(base, "nosuch", "on");
    expect(unknown.status).toBe(400);
    expect(existsSync(join(dir, "owned", "nosuch", "pinned"))).toBe(false);
    const maybe = await pin(base, "gamma", "maybe");
    expect(maybe.status).toBe(400);
    const answer = (await maybe.json()) as { results: { error?: string }[] };
    expect(answer.results[0]!.error).toBe("Pin is on or off.");
    expect(existsSync(join(dir, "owned", "gamma", "pinned"))).toBe(false);
  });

  test("pinning and unpinning leave the project's repository untouched (AC-5)", async () => {
    const { base, dir } = board();
    const project = join(dir, "root", "gamma");
    const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: project }).stdout.toString();
    const head = git("rev-parse", "HEAD");
    await pin(base, "gamma", "on");
    await pin(base, "gamma", "off");
    expect(git("status", "--porcelain")).toBe("");
    expect(git("rev-parse", "HEAD")).toBe(head);
  });
});

describe("a pinned project in the board's lists", () => {
  test("the Config tab's Pin switch posts to the pin route and shows whether the project is pinned (AC-1)", async () => {
    const { base } = board();
    await pin(base, "gamma", "on");
    const pinSwitch = async (name: string) =>
      (await page(base, `/projects/${name}?tab=config`)).querySelector(`form[action="/projects/${name}/pin"] [role="switch"]`);
    expect((await pinSwitch("gamma"))?.getAttribute("aria-checked")).toBe("true");
    expect((await pinSwitch("aide"))?.getAttribute("aria-checked")).toBe("false");
  });

  test("comes first in the picker, the New spec form and the Project filters on Specs and Jobs (AC-2)", async () => {
    const { base } = board();
    await pin(base, "gamma", "on");
    const picker = [...(await page(base, "/projects/aide?tab=config")).querySelectorAll(".projectpicker .menupanel a > span:last-child")]
      .map((s) => s.textContent);
    expect(picker).toEqual(["gamma", "aide", "beta"]);
    const choice = [...(await page(base, "/new")).querySelectorAll('select[name="project"] option')]
      .map((o) => o.getAttribute("value")).filter(Boolean);
    expect(choice).toEqual(["gamma", "aide", "beta"]);
    expect(await filtered(base, "/specs")).toEqual(["gamma", "aide", "beta"]);
    expect(await filtered(base, "/")).toEqual(["gamma", "aide", "beta"]);
  });
});
