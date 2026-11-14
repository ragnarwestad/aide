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

// --- Create with no AI session at all -------------------------------

describe("--no-ai-formulate reaches the runner only when the job says so", () => {
  test("present when the job's box was cleared, absent otherwise", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve-helpers");
    const job = {
      project: "aide", specFolder: "new-abc123de", steps: ["create"],
       timeoutSec: 2700, permissionMode: {}, model: {},
      createTitle: "A new spec", createDescription: "Do the thing",
      createNoAiFormulate: true,
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "create", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(argv).toContain("--no-ai-formulate");

    const ticked = { ...job, createNoAiFormulate: undefined } as unknown as Parameters<typeof runnerArgv>[0];
    const argvTicked = runnerArgv(ticked, "create", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(argvTicked).not.toContain("--no-ai-formulate");
  });

  test("never appended for a step other than create", async () => {
    const { runnerArgv } = await import("../../../src/serve/serve-helpers");
    const job = {
      project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"],
       timeoutSec: 2700, permissionMode: {}, model: {},
      createNoAiFormulate: true,
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(argv).not.toContain("--no-ai-formulate");
  });
});

// --- the new spec's acceptance criteria checks level --------------------------

describe("--criteria-checks reaches the runner only for a create that chose a level", () => {
  const job = (step: string, level?: string) =>
    ({
      project: "aide", specFolder: "new-abc123de", steps: [step],
      timeoutSec: 2700, permissionMode: {}, model: {},
      createTitle: "A new spec", createDescription: "Do the thing",
      ...(level ? { createCriteriaChecks: level } : {}),
    }) as unknown as Parameters<typeof import("../../../src/serve/serve-helpers").runnerArgv>[0];

  const argvFor = async (step: string, level?: string) => {
    const { runnerArgv } = await import("../../../src/serve/serve-helpers");
    return runnerArgv(job(step, level), step, "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
  };

  test("a create with Stop chosen passes --criteria-checks stop", async () => {
    const argv = await argvFor("create", "stop");
    expect(argv[argv.indexOf("--criteria-checks") + 1]).toBe("stop");
  });

  test("a create without a level passes no flag", async () => {
    expect(await argvFor("create")).not.toContain("--criteria-checks");
  });

  test.each([["analyze"], ["implement"]])("never for %s", async (step) => {
    expect(await argvFor(step, "stop")).not.toContain("--criteria-checks");
  });
});

// --- whether the new spec asks to choose between its approaches ---------------

describe("--choose-approach reaches the runner for a create from the form", () => {
  const job = (step: string, chooseApproach?: boolean) =>
    ({
      project: "aide", specFolder: "new-abc123de", steps: [step],
      timeoutSec: 2700, permissionMode: {}, model: {},
      createTitle: "A new spec", createDescription: "Do the thing",
      ...(chooseApproach === undefined ? {} : { createChooseApproach: chooseApproach }),
    }) as unknown as Parameters<typeof import("../../../src/serve/serve-helpers").runnerArgv>[0];

  const argvFor = async (step: string, chooseApproach?: boolean) => {
    const { runnerArgv } = await import("../../../src/serve/serve-helpers");
    return runnerArgv(job(step, chooseApproach), step, "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
  };

  test.each([[true, "yes"], [false, "no"]])("a create with the box %p passes --choose-approach %s", async (ticked, value) => {
    const argv = await argvFor("create", ticked);
    expect(argv[argv.indexOf("--choose-approach") + 1]).toBe(value);
  });

  test("a create job from before the box existed passes no flag", async () => {
    expect(await argvFor("create")).not.toContain("--choose-approach");
  });

  test.each([["analyze"], ["implement"]])("never for %s", async (step) => {
    expect(await argvFor(step, true)).not.toContain("--choose-approach");
  });
});

// --- What a new spec builds on --------------------------------------

describe("a chosen dependency reaches the runner and the page", () => {
  const createJob = (dependsOn?: string[]) =>
    ({
      project: "aide", specFolder: "new-abcd1234", steps: ["create"],
       timeoutSec: 2700, permissionMode: {}, model: {},
      createTitle: "A new spec", createDescription: "Do the thing",
      ...(dependsOn ? { createDependsOn: dependsOn } : {}),
    }) as unknown as Parameters<typeof import("../../../src/serve/serve-helpers").runnerArgv>[0];

  const argvFor = async (dependsOn?: string[]) => {
    const { runnerArgv } = await import("../../../src/serve/serve-helpers");
    return runnerArgv(createJob(dependsOn), "create", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
  };

  test("every chosen folder goes over as one --depends-on value", async () => {
    const argv = await argvFor(["92-a-spec-can-depend", "97-freshness"]);
    expect(argv).toContain("--depends-on");
    expect(argv[argv.indexOf("--depends-on") + 1]).toBe("92-a-spec-can-depend,97-freshness");
    // The two fields it sits beside are untouched.
    expect(argv[argv.indexOf("--title") + 1]).toBe("A new spec");
  });

  test("a create that names none passes no such flag", async () => {
    expect(await argvFor()).not.toContain("--depends-on");
    expect(await argvFor([])).not.toContain("--depends-on");
  });

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

  // The model the create step runs on, chosen on the form
  // itself. Posted form-encoded, as the form posts it, which is the body
  // `bodyToObject` folds `model.create` into the per-step shape on.
  test("a removed model field does not create queue state", async () => {
    const { base } = start({
      queueDefaults: {
        timeoutSec: { default: 1200 },
        permissionMode: { default: "acceptEdits" },
        model: { default: "sonnet" },
        modelChoices: { sonnet: { }, fable: {  } },
      },
    });
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ ...CREATE, "model.create": "fable" }).toString(),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { specFolder: string }).specFolder).toBe("999-a-new-spec");

    // ...and a name this server does not offer is refused, rather than
    // quietly falling back to the default.
    const bad = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ ...CREATE, "model.create": "opus" }).toString(),
    });
    expect(bad.status).toBe(400);
  });

  // The provider is posted beside the model as `provider.<step>`, and
  // `bodyToObject` folds it into the per-step shape the parser reads.
  test("a removed provider field does not create queue state", async () => {
    const { base } = start({
      queueDefaults: {
        timeoutSec: { default: 1200 },
        permissionMode: { default: "acceptEdits" },
        model: { default: "sonnet" },
        modelChoices: { sonnet: {} },
        providers: { Claude: { name: "Claude", tool: "claude" }, Capra: { name: "Claude-Capra", tool: "claude", configDir: "~/.claude-capra" } },
      },
    });
    const res = await fetch(`${base}/api/queue/create`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ ...CREATE, "model.create": "sonnet", "provider.create": "Capra" }).toString(),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { specFolder: string }).specFolder).toBe("999-a-new-spec");
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

  test("?tab=options opens the Options tab, and no tab opens Spec", async () => {
    const { base } = start();
    const options = await (await fetch(`${base}/new?tab=options`)).text();
    expect(options).toContain('<div data-tab-panel="options">');
    expect(options).toContain('<div data-tab-panel="spec" hidden>');
    const plain = await (await fetch(`${base}/new`)).text();
    expect(plain).toContain('<div data-tab-panel="spec">');
  });

});
