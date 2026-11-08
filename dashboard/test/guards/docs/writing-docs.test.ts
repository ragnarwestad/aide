// The writing rule says which pages it governs through its own `paths:`,
// and a page that cannot be reached from another is a page nobody finds.
//
// Two things can be checked by code: that the rule's `paths:` match exactly
// the development pages (and no other Markdown file), and that every
// relative link on those pages reaches a file and a heading that exist.
// Whether a page follows the rule is a reading, not a test.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";

const REPO = join(import.meta.dir, "..", "..", "..", "..");
const RULE = ".claude/rules/writing-docs.md";

/** The `paths:` list of a rule, as written. */
function rulePaths(): string[] {
  const text = readFileSync(join(REPO, RULE), "utf-8");
  const front = text.match(/^---\n([\s\S]*?)\n---/);
  if (!front) throw new Error(`${RULE} has no frontmatter`);
  const paths = (parse(front[1]!) as { paths?: string[] }).paths;
  if (!Array.isArray(paths)) throw new Error(`${RULE} has no paths:`);
  return paths;
}

/** Claude Code reads `paths:` the way gitignore does: a leading `/` anchors
 *  a pattern to the folder that holds `.claude/`, and a pattern with no `/`
 *  at all matches at any depth. `Bun.Glob` matches from the root only. */
function toGlob(pattern: string): string {
  if (pattern.startsWith("/")) return pattern.slice(1);
  return pattern.includes("/") ? pattern : `**/${pattern}`;
}

function scan(glob: string): string[] {
  return [
    ...new Bun.Glob(glob).scanSync({ cwd: REPO, dot: true, onlyFiles: true }),
  ].filter(
    (f) =>
      !f.split("/").some((part) => part === "node_modules" || part === ".venv"),
  );
}

function pagesMatchedByRule(): string[] {
  return [...new Set(rulePaths().flatMap((p) => scan(toGlob(p))))].sort();
}

/** The pages in scope, listed independently of the rule. */
function pagesInScope(): string[] {
  const files = [
    ...scan("dashboard/docs/**/*.md"),
    ...scan("dashboard/.claude/rules/*.md"),
    ...scan(".claude/rules/*.md"),
    ...scan("core/implementations/**/*.md"),
    ...scan("docs/*.md").filter(
      (f) => f !== "docs/AI_NEWS_LOG.md" && f !== "docs/ROADMAP.md",
    ),
    "dashboard/README.md",
    "dashboard/CLAUDE.md",
    "README.md",
    "DEVELOPING.md",
    ".claude/CLAUDE.md",
  ];
  return [...new Set(files)].sort();
}

// ---------------------------------------------------------------- links

/** markdownlint's MD051 anchor: lower case, inline markup dropped, every
 *  character that is not a letter, mark, number, connector punctuation,
 *  `-` or space removed, each space a `-`. */
export function anchorOf(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

function withoutCode(text: string): string {
  return text
    .replace(/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, "")
    .replace(/(`+)[^`\n][\s\S]*?\1/g, "");
}

export function anchorsOf(text: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const m of withoutCode(text).matchAll(
    /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm,
  )) {
    const base = anchorOf(m[1]!);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

interface Files {
  exists(path: string): boolean;
  read(path: string): string;
}

/** Every relative link in `text` (written in the file at `path`) whose file or
 *  heading is missing. Links in code blocks and inline code, absolute URLs and
 *  links to a heading of the same page are not checked. */
export function brokenLinks(
  text: string,
  path: string,
  files: Files,
): string[] {
  const prose = withoutCode(text);
  const targets = [
    ...[
      ...prose.matchAll(
        /!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
      ),
    ].map((m) => m[1]!),
    ...[
      ...prose.matchAll(
        /^ {0,3}\[[^\]\n]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/gm,
      ),
    ].map((m) => m[1]!),
  ];
  const broken: string[] = [];
  for (const target of targets) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(target)) continue;
    const [file = "", fragment] = target.split("#");
    const resolved = resolve(dirname(path), decodeURI(file.split("?")[0]!));
    if (!files.exists(resolved)) {
      broken.push(target);
    } else if (
      fragment &&
      resolved.endsWith(".md") &&
      !anchorsOf(files.read(resolved)).has(decodeURI(fragment))
    ) {
      broken.push(target);
    }
  }
  return broken;
}

const onDisk: Files = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, "utf-8"),
};

// ---------------------------------------------------------------- tests

describe("the writing rule's paths cover the development pages", () => {
  test("they match exactly the pages in scope (AC-1)", () => {
    expect(pagesMatchedByRule()).toEqual(pagesInScope());
  });

  test("they match no other Markdown file (AC-1)", () => {
    const matched = new Set(pagesMatchedByRule());
    for (const out of [
      "core/tests/README.md",
      "specs/README.md",
      "dashboard/test/round/fixture-project/README.md",
      "docs/AI_NEWS_LOG.md",
      "docs/ROADMAP.md",
      "core/AGENTS.md",
    ]) {
      expect(matched.has(out)).toBe(false);
    }
    const outside = [...matched].filter((f) =>
      /^(docs\/prompts|core\/skills|core\/rules|\.claude\/skills|specs)\//.test(
        f,
      ),
    );
    expect(outside).toEqual([]);
  });
});

describe("a relative link reaches a file and a heading that exist", () => {
  test("every link on every page in scope (AC-7)", () => {
    const broken: Record<string, string[]> = {};
    for (const page of pagesMatchedByRule()) {
      const links = brokenLinks(
        readFileSync(join(REPO, page), "utf-8"),
        join(REPO, page),
        onDisk,
      );
      if (links.length > 0) broken[page] = links;
    }
    expect(broken).toEqual({});
  });

  const page = join(REPO, "docs", "page.md");
  const other = join(REPO, "docs", "other.md");
  const files: Files = {
    exists: (p) => p === page || p === other,
    read: () =>
      "# Other\n\n## Review — three reviewers\n\n## Same\n\n## Same\n",
  };

  test("the check reports a missing file and a missing heading, and nothing else (AC-7)", () => {
    const text = [
      "[file](missing.md) [heading](other.md#no-such-heading)",
      "[fine](other.md#review--three-reviewers) [second](other.md#same-1) [top](other.md)",
      "[web](https://example.com/x.md) [here](#a-heading-on-this-page)",
      "`[inline](gone.md)`",
      "```",
      "[fenced](gone.md)",
      "```",
    ].join("\n");
    expect(brokenLinks(text, page, files)).toEqual([
      "missing.md",
      "other.md#no-such-heading",
    ]);
  });
});
