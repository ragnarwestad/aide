import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  renderNewSpecPage,
  renderSpecsPage,
  type NewSpecPageOptions,
} from "../../../src/render";
import { specHead, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// --- What a new spec builds on --------------------------------------

describe("a chosen dependency reaches the runner and the page", () => {
  test("one ticked chip arrives as a list, not a bare string", async () => {
    let received: import("../../../src/serve/routes/direct-create/index.ts").DirectCreateInput | undefined;
    const { base } = start({
      queueProjects: ["aide"],
      directCreateSpec: async (input) => {
        received = input;
        return { ok: true, specFolder: "999-a-new-spec" };
      },
    });
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        project: "aide",
        title: "A new spec",
        description: "Do the thing",
        dependsOn: "81-queue-and-runner",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { specFolder: string };
    expect(body.specFolder).toBe("999-a-new-spec");
    expect(received?.dependsOn).toEqual(["81-queue-and-runner"]);
  });
});

describe("a create post fits the description the page lets the user type", () => {
  test("a full-length title and description, every character encoding to the most bytes, is taken", async () => {
    const { DESCRIPTION_MAX, TITLE_MAX } = await import("../../../src/queue/parse-request.ts");
    let received: import("../../../src/serve/routes/direct-create/index.ts").DirectCreateInput | undefined;
    const { base } = start({
      queueProjects: ["aide"],
      directCreateSpec: async (input) => {
        received = input;
        return { ok: true, specFolder: "999-" };
      },
    });
    // "—" is three UTF-8 bytes, nine once form-encoded: the most a single
    // character the fields count can cost.
    const title = "—".repeat(TITLE_MAX);
    const description = "—".repeat(DESCRIPTION_MAX);
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ project: "aide", title, description }).toString(),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { specFolder: string }).specFolder).toBe("999-");
    expect(received?.title).toBe(title);
    expect(received?.description).toBe(description);
  });
});

// --- Reordering the page must not change what a create posts ------
//
// The New-spec page's fields are read by NAME (parse-request.ts), never
// by position, so moving Create onto the Project field's own line and
// moving Title/Description ahead of Depends on and the phase table is a
// pure layout change. This is the regression check for that claim: the
// reordered page still carries every field name a create needs, and a
// request built from them still parses to the same job it would have
// before the reorder.
describe("a request built from the reordered form's own field names", () => {
  test("project, title, description, dependencies and spec settings all still parse", async () => {
    let received: import("../../../src/serve/routes/direct-create/index.ts").DirectCreateInput | undefined;
    const { base } = start({
      queueProjects: ["aide"],
      directCreateSpec: async (input) => {
        received = input;
        return { ok: true, specFolder: "999-a-new-spec" };
      },
    });
    const html = await (await fetch(`${base}/new`)).text();
    for (const name of [
      'name="project"',
      'name="title"',
      'name="description"',
      'name="dependsOn"',
      'name="acceptanceRequired"',
    ]) {
      expect(html).toContain(name);
    }
    const body = new URLSearchParams();
    body.set("project", "aide");
    body.set("title", "A new spec");
    body.set("description", "Do the thing");
    body.set("dependsOn", "81-queue-and-runner");
    body.set("acceptanceRequired", "1");
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { ok: boolean; specFolder: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.specFolder).toBe("999-a-new-spec");
    expect(received).toEqual({
      project: "aide",
      title: "A new spec",
      description: "Do the thing",
      dependsOn: ["81-queue-and-runner"],
      acceptanceRequired: true,
      criteriaChecks: undefined,
      chooseApproach: false,
    });
  });
});

describe("the New-spec form offers what the spec may build on", () => {
  // On its own page — the chips, their order and their
  // scoping.
  const page = (targets: NewSpecPageOptions["targets"]) =>
    renderNewSpecPage([{ label: "Overview", path: "projects.html" }], "2026-08-16T00:00:00Z", {
      targets,
      createProjects: ["aide", "aide-dashboard"],
    });
  const form = (html: string): string => html.slice(html.indexOf('action="/api/queue/create"'));

  const TARGETS = [
    { project: "aide", specFolder: "09-ninth" },
    { project: "aide", specFolder: "92-a-spec-can-depend" },
    { project: "aide-dashboard", specFolder: "01-first" },
  ];

  test("newest first — the number is the order a reader thinks in", () => {
    const html = form(page(TARGETS));
    expect(html.indexOf('value="92-a-spec-can-depend"')).toBeLessThan(html.indexOf('value="09-ninth"'));
  });

});

describe("a spec's row says what it depends on", () => {
  const row = (dependsOn: string[]) =>
    specHead(
      renderSpecsPage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "109-expanded-row", title: "Expanded row", dependsOn }],
      }),
      "109-expanded-row",
    );

  // Use the project and number, keeping nonnumeric dependency names whole.
  test("named by project and number, however the dependency itself was written", () => {
    expect(row(["105-busy-row"])).toContain("Depends on: aide:105");
    expect(row(["105-busy-row", "92-a-spec-can-depend"])).toContain("Depends on: aide:105, aide:92");
    expect(row(["105"])).toContain("Depends on: aide:105");
    // Anything that does not open with a number is shown whole rather
    // than silently truncated.
    expect(row(["a-named-thing"])).toContain("Depends on: aide:a-named-thing");
  });

});
// --- Making a spec from the page ------------------------------------

// Every spec that exists is a row here and can be started from its own
// line. A spec that does not exist yet has no row, and until now the only
// way to make one was `/aide-create` in a terminal, then a push, then a
// pull on the serving host. This is the third way in: a form, a job like
// any other, and — because a spec stays invisible to the list until its
// branch lands on the default branch — a landing step that merges through
// the very same function the Merge button already uses.
describe("POST /api/queue/create", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json" };
  const CREATE = { project: "aide", title: "A new spec", description: "Do the thing" };

  test("a create request writes a final folder and queues no job (AC-1)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(CREATE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; specFolder: string };
    expect(body.ok).toBe(true);
    expect(body.specFolder).toBe("999-a-new-spec");
  });

  test("a newly created spec warms its workflow history immediately", async () => {
    const warmed: Array<[string, string]> = [];
    const { base } = start({
      directCreateSpec: async () => ({ ok: true, specFolder: "999-a-new-spec", specDir: "/specs/999-a-new-spec" }),
      rereadSpec: async (dir, folder) => { warmed.push([dir, folder]); },
    });

    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(CREATE),
    });

    expect(res.status).toBe(200);
    expect(warmed).toEqual([["/specs/999-a-new-spec", "999-a-new-spec"]]);
  });

  test("an archived spec is accepted as a dependency", async () => {
    let received: { dependsOn: string[] } | undefined;
    const { base } = harness.start({
      archivedSpecs: { "77-finished-work": {} },
      extra: {
        directCreateSpec: async (input) => {
          received = input;
          return { ok: true, specFolder: "999-a-new-spec" };
        },
      },
    });
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ ...CREATE, dependsOn: ["77-finished-work"] }),
    });
    expect(res.status).toBe(200);
    expect(received?.dependsOn).toEqual(["77-finished-work"]);
  });

  test("a project that is allowlisted but has never had a spec is still accepted", async () => {
    // `resolveProject` answers "not found" for such a project — the gap
    // that makes a project's FIRST spec uncreatable today.
    const { base } = start({ queueProjects: ["aide", "brandnew"] });
    const ok = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ ...CREATE, project: "brandnew" }),
    });
    expect(ok.status).toBe(200);
    // ...while the ORDINARY route still refuses it: the widening is for
    // one endpoint, not for the queue.
    const refused = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "brandnew", specFolder: "01-first", steps: ["analyze"] }),
    });
    expect(refused.status).toBe(400);
  });

  test("a project outside the allowlist is refused, and so is a half-filled form", async () => {
    const { base } = start();
    for (const body of [
      { ...CREATE, project: "someone-elses" },
      { project: "aide", description: "Do the thing" },
      { project: "aide", title: "A new spec" },
    ]) {
      const res = await fetch(`${base}/api/queue/create`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  // The queue mirror is only written once a job is inserted, so a
  // refusal leaves it missing or empty.
  const queued = (dir: string): unknown[] => {
    const file = join(dir, "queue.json");
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as unknown[]) : [];
  };

  test("a request naming no project is refused with 400 and queues nothing", async () => {
    const { base, dir } = start();
    const { project: _named, ...noKey } = CREATE;
    for (const body of [noKey, { ...CREATE, project: null }, { ...CREATE, project: "" }]) {
      const res = await fetch(`${base}/api/queue/create`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("project is required");
    }
    expect(queued(dir)).toEqual([]);
  });

  test("the form posted with the placeholder chosen is refused, saying a project is required", async () => {
    const { base, dir } = start();
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ project: "", title: "A new spec", description: "Do the thing" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("project is required");
    expect(queued(dir)).toEqual([]);
  });

  test("it answers POST only", async () => {
    const { base } = start();
    expect((await fetch(`${base}/api/queue/create`, { headers: AUTH })).status).toBe(405);
  });

  test("the form offers every allowlisted project, spec or no spec", async () => {
    const { base } = start({ queueProjects: ["aide", "brandnew"] });
    const html = await (await fetch(`${base}/new`, )).text();
    const form = html.slice(html.indexOf('action="/api/queue/create"'));
    expect(form).toContain('value="brandnew"');
  });
});

// --- GET /new -----------------------------------------------------
//
// The form left `/` for a page of its own. Served like `/` and
// `/projects` are — same guard, same one-time token handover — because
// it carries a real form and a real form needs a token checked per
// request.
describe("GET /new", () => {
  test("it answers GET only", async () => {
    const { base } = start();
    expect((await fetch(`${base}/new`, { method: "POST" })).status).toBe(405);
  });

  test("the chips name every spec the new one may build on", async () => {
    const { base } = start();
    const html = await (await fetch(`${base}/new`)).text();
    expect(html).toContain('value="81-queue-and-runner"');
  });

  test("with no project on the allowlist it says so instead of drawing an empty form", async () => {
    const { base } = start({ queueProjects: [] });
    const html = await (await fetch(`${base}/new`)).text();
    expect(html).not.toContain('action="/api/queue/create"');
    expect(html).toContain("No project on this machine");
  });

});
