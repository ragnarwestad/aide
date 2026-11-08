// What the Installation tab under a provider shows of the last check: a
// table of where aide is installed for the tool, and under it a line only
// for what is wrong. The login answers the check also holds are not drawn
// there: the provider's page shows the login above the tab.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { installationBlock, type ToolCheck } from "../../../src/render";

const AT = "2026-10-03T13:30:00.000Z";

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

function parse(html: string): Document {
  const win = new Window();
  windows.push(win);
  win.document.write(html);
  return win.document as unknown as Document;
}

const installation = (check: ToolCheck) =>
  parse(installationBlock(check, "en"));

/** The table's rows as [what the place holds, its path]. */
const rows = (doc: Document) =>
  [...doc.querySelectorAll("table.facts tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
  );

/** The lines under the table. */
const lines = (doc: Document) =>
  [...doc.querySelectorAll(".rowmsg")].map((m) => m.textContent ?? "");

const check = (
  tool: ToolCheck["tool"],
  rest: Partial<ToolCheck> = {},
): ToolCheck => ({
  tool,
  at: AT,
  found: true,
  extra: [],
  ...rest,
});

describe("the table on the Installation tab", () => {
  test("a Claude Code provider's has a row for each place the table names for it (AC-1)", () => {
    expect(rows(installation(check("claude")))).toEqual([
      ["Skills", "~/.claude/skills/"],
      ["Rules", "~/.claude/rules/"],
      ["Scripts", "~/.local/bin/"],
    ]);
  });

  test("a place only read in place is a row too, and two places for hooks both read Hooks (AC-1)", () => {
    expect(
      rows(installation(check("opencode"))).map(([label]) => label),
    ).toEqual(["Instructions", "Skills", "Skills"]);
    expect(
      rows(installation(check("codex"))).filter(([label]) => label === "Hooks"),
    ).toEqual([
      ["Hooks", "~/.codex/hooks.json"],
      ["Hooks", "~/.codex/hooks/"],
    ]);
  });

  test("a check that could not be run is said under the table, which is still drawn (AC-9, AC-1)", () => {
    const html = installationBlock(
      check("codex", {
        found: false,
        error: "The check did not finish in time.",
      }),
      "en",
    );
    expect(html.indexOf("<table")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("<table")).toBeLessThan(
      html.indexOf("The check did not finish in time."),
    );
    expect(lines(parse(html))).toEqual(["The check did not finish in time."]);
  });
});

describe("a place the host has moved", () => {
  test("is shown, and named when missing, at the path the host reported (AC-1, AC-2)", () => {
    const moved = check("opencode", {
      paths: { instructions: "/srv/config/opencode/AGENTS.md" },
      missing: ["instructions"],
    });
    const doc = installation(moved);
    expect(rows(doc)[0]).toEqual([
      "Instructions",
      "/srv/config/opencode/AGENTS.md",
    ]);
    expect(lines(doc)[0]).toContain("/srv/config/opencode/AGENTS.md");
  });
});

describe("the lines under the table", () => {
  test("a place missing on the host is named by its path, with Deploy as the advice (AC-2)", () => {
    const [line, ...more] = lines(
      installation(check("codex", { missing: ["hookConfig", "hooks"] })),
    );
    expect(more).toEqual([]);
    expect(line).toContain("~/.codex/hooks.json");
    expect(line).toContain("~/.codex/hooks/");
    expect(line).not.toContain("~/.codex/AGENTS.md");
    expect(line).toContain("Deploy");
  });

  test("installed files behind the repository are said, with Deploy as the advice (AC-3)", () => {
    const [line, ...more] = lines(
      installation(check("claude", { behind: true })),
    );
    expect(more).toEqual([]);
    expect(line).toContain("behind");
    expect(line).toContain("Deploy");
  });

  test("a command line that is not found is said, naming the tool (AC-4)", () => {
    const [line, ...more] = lines(
      installation(check("codex", { found: false })),
    );
    expect(more).toEqual([]);
    expect(line).toContain("Codex");
  });

  test("with every place there, the files matching and the command line found, the tab is the table and nothing else (AC-5, AC-6)", () => {
    for (const tool of ["claude", "codex", "opencode"] as const) {
      const doc = installation(check(tool, { missing: [], behind: false }));
      expect(lines(doc)).toEqual([]);
      expect(doc.body.textContent).toBe(rows(doc).flat().join(""));
    }
  });

  test("a tab with problems holds the table's rows and those lines alone, no login answer (AC-6)", () => {
    const doc = installation(
      check("claude", {
        found: false,
        missing: ["scripts"],
        behind: true,
        extra: [
          {
            question: "Is it logged in?",
            ok: true,
            detail: "",
            answer: { key: "login.in" },
          },
        ],
      }),
    );
    expect(lines(doc).length).toBe(3);
    expect(doc.body.textContent).toBe(
      rows(doc).flat().join("") + lines(doc).join(""),
    );
  });
});
