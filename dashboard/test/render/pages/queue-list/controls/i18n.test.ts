// Spec 350, REQ-6/REQ-8: `lang: "nb"` renders a Norwegian string from
// every covered surface of the Specs list, with the matching English
// original absent — proving the threading reaches every file in Scope,
// not just the shell.
import { describe, expect, test } from "bun:test";
import { renderQueuePage, renderQueueRows, type QueuePageOptions, type QueueTarget } from "../../../../../src/render.ts";
import { row } from "../../fixtures.ts";

const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
  project: "aide",
  specFolder,
  ...extra,
});

const page = (opts: Partial<QueuePageOptions> = {}): string =>
  renderQueuePage([], "2026-09-02T00:00:00Z", [{ label: "Projects", path: "/projects" }], {
    runnerAvailable: true,
    targets: [],
    ...opts,
  });

describe("the Specs list in Norwegian (spec 350)", () => {
  test("the filter bar: search placeholder, New-spec link, column heading", () => {
    const html = page({ lang: "nb", createProjects: ["aide"] });
    expect(html).toContain('placeholder="et ord i ett av tre felt"');
    expect(html).toContain(">Ny<");
    expect(html).toContain(">Spesifikasjon<");
    expect(html).not.toContain('placeholder="a word in any of three fields"');
    expect(html).not.toContain(">New<");
  });

  test("a state word: a running row's badge is Norwegian", () => {
    const html = renderQueueRows(
      [row({ id: "r1", specFolder: "1-x", steps: ["analyze"], stepIndex: 0, state: "running" })],
      { runnerAvailable: true, targets: [{ project: "aide", specFolder: "1-x" }], lang: "nb" },
    );
    expect(html).toContain("analyserer");
    expect(html).not.toContain("analyzing");
  });

  test("a mark: a row waiting on a pull request reads pull-forespørsel", () => {
    const html = renderQueueRows(
      [row({ id: "r2", specFolder: "2-x", steps: ["implement"], state: "done", prUrl: "https://github.test/aide/pull/1" })],
      { runnerAvailable: true, targets: [{ project: "aide", specFolder: "2-x" }], lang: "nb" },
    );
    expect(html).toContain("pull-forespørsel");
    expect(html).not.toContain(">pull request<");
  });

  test("a notice line: a held-back archive reads 'arkivering holdt tilbake: <reason>'", () => {
    const html = renderQueueRows(
      [row({ id: "r3", specFolder: "3-x", steps: ["archive"], state: "done" })],
      {
        runnerAvailable: true,
        targets: [target("3-x", { done: ["analyze", "implement"], archiveHeldBack: { reason: "a real reason" } })],
        filter: { open: "aide/3-x" },
        lang: "nb",
      },
    );
    expect(html).toContain("arkivering holdt tilbake: a real reason");
    expect(html).not.toContain("archive held back —");
  });

  test("the empty-list message is Norwegian", () => {
    const html = page({ lang: "nb" });
    expect(html).toContain("Ingen spec å vise");
    expect(html).not.toContain("No spec to show");
  });
});

// The row's message panel says three things about one spec: the phase
// whose own last run stopped, the job the scheduler is holding, and the
// marks beside them. The first reached the page in English whatever the
// language was — `phaseDisagreement` never took one — and it is the one
// that already names its phase, which is what the held-back line beside
// it now does too.
describe("the row's message panel", () => {
  const held = (): string =>
    renderQueueRows(
      [
        row({
          id: "h1",
          specFolder: "9-held",
          steps: ["implement"],
          stepIndex: 0,
          state: "queued",
          error: { key: "runner.notAnalyzed" },
          errorReason: "held-back",
        }),
      ],
      { runnerAvailable: true, targets: [target("9-held")], lang: "nb" },
    );

  const stopped = (lang: "en" | "nb"): string =>
    renderQueueRows([], {
      runnerAvailable: true,
      targets: [target("9-stopped", { done: ["analyze"], stopped: { archive: "not-implemented-yet" } })],
      lang,
    });

  test("a phase whose last run stopped says so in Norwegian", () => {
    const html = stopped("nb");
    expect(html).toContain("ingenting er implementert ennå");
    expect(html).not.toContain("nothing is implemented yet");
  });

  test("the same line in English is unchanged", () => {
    expect(stopped("en")).toContain("archive stopped: nothing is implemented yet");
  });

  test("a held-back job names the phase that is waiting", () => {
    expect(held()).toContain("implement holdt tilbake:");
  });
});
