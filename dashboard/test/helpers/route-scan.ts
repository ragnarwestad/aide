// Reads the dashboard's route handlers and docs/http-routes.md as two lists
// of routes, so a guard can compare them.
//
// A handler names a path in one of these ways, and each is read here; a
// person adding a fourth way extends `sitesIn`:
//   1. `path === "/x"` or `path !== "/x"`, also against a constant name;
//   2. `path.startsWith("/x/")`;
//   3. a regex, inline in `path.match(/^…$/)` or a file-local constant used
//      as `NAME.exec(path)`, `NAME.test(path)` or `path.match(NAME)`.
// The method is the first `req.method` comparison in the few lines after
// the site, and the next one when that comparison is `===`.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface SourceRoute {
  path: string;
  methods: string[];
}
export interface PageRoute {
  method: string;
  path: string;
  kind: string;
  takes: string;
  answers: string;
  madeFor: string;
}
export interface RouteGaps {
  missingRows: string[];
  unknownRows: string[];
  wrongMethod: string[];
}

const FALLBACK_ROW = "/<file>";
const METHOD_WINDOW = 6;
const CONSTANT = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*"(\/[^"]*)"/g;
const NAMED_REGEX = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+)\/;/g;
const REGEX_BODY = String.raw`\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+)\/`;
const METHOD_CHECK = /req\.method\s*(===|!==)\s*"([A-Z]+)"/g;

const wildcard = (path: string): string => path.replace(/<[^>]+>/g, "*");

/** `^\/api\/queue\/([^/]+)\/cancel$` -> the paths it matches, captures as `*`. */
const regexPaths = (body: string): string[] => {
  let paths = [body.replace(/^\^/, "").replace(/\$$/, "").replace(/\\\//g, "/")];
  for (;;) {
    const next = paths.flatMap((p) => {
      const group = /\(([^()]*)\)/.exec(p);
      if (!group) return [p];
      const inner = group[1]!;
      const parts = inner.includes("|") && !inner.includes("[") ? inner.split("|") : ["*"];
      return parts.map((part) => p.slice(0, group.index) + part + p.slice(group.index + group[0].length));
    });
    if (next.join("\n") === paths.join("\n")) return paths;
    paths = next;
  }
};

interface Site {
  line: number;
  paths: string[];
}

const sitesIn = (text: string, constants: Record<string, string>): Site[] => {
  const local: Record<string, string> = { ...constants };
  for (const m of text.matchAll(CONSTANT)) local[m[1]!] = m[2]!;
  const namedRegex = new Map<string, string>();
  for (const m of text.matchAll(NAMED_REGEX)) namedRegex.set(m[1]!, m[2]!);

  const sites: Site[] = [];
  text.split("\n").forEach((line, line0) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const paths: string[] = [];
    for (const m of line.matchAll(/\bpath\s*[!=]==\s*(?:"([^"]*)"|([A-Z][A-Z0-9_]*))/g)) {
      if (m[1] !== undefined) paths.push(m[1]);
      else if (local[m[2]!] !== undefined) paths.push(local[m[2]!]!);
      else throw new Error(`route-scan: cannot resolve the constant ${m[2]} on line ${line0 + 1}`);
    }
    for (const m of line.matchAll(/\bpath\.startsWith\("([^"]*)"\)/g)) paths.push(`${m[1]}*`);
    for (const m of line.matchAll(new RegExp(String.raw`\bpath\.match\(${REGEX_BODY}\)`, "g"))) {
      paths.push(...regexPaths(m[1]!));
    }
    for (const [name, body] of namedRegex) {
      const use = new RegExp(String.raw`\b${name}\.(?:exec|test)\(path\)|\bpath\.match\(${name}\)`);
      if (use.test(line)) paths.push(...regexPaths(body));
    }
    if (paths.length > 0) sites.push({ line: line0, paths });
  });
  return sites;
};

const methodsAfter = (lines: string[], from: number, until: number): string[] => {
  const methods: string[] = [];
  const end = Math.min(until, from + 1 + METHOD_WINDOW);
  for (const m of lines.slice(from + 1, end).join("\n").matchAll(METHOD_CHECK)) {
    methods.push(m[2]!);
    if (m[1] !== "===") break;
  }
  return methods;
};

/** Pure: file name -> text in, routes out. `constants` maps a name to the path
 *  it holds; a name it cannot resolve throws. */
export const scanSource = (files: Record<string, string>, constants: Record<string, string>): SourceRoute[] => {
  const found = new Map<string, Set<string>>();
  for (const text of Object.values(files)) {
    const lines = text.split("\n");
    const sites = sitesIn(text, constants);
    sites.forEach((site, i) => {
      const until = sites[i + 1]?.line ?? lines.length;
      const methods = methodsAfter(lines, site.line, until);
      for (const raw of site.paths) {
        const path = wildcard(raw);
        const known = found.get(path) ?? new Set<string>();
        for (const m of methods) known.add(m);
        found.set(path, known);
      }
    });
  }
  return [...found]
    .map(([path, methods]) => ({ path, methods: [...methods].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path));
};

/** The 26 files of the scan roots by relative path, and the constants of every file under src/. */
export const readServeSources = (
  root: string,
): { files: Record<string, string>; constants: Record<string, string> } => {
  const files: Record<string, string> = {};
  const globs = ["src/serve/routes/**/*.ts", "src/serve/core-routes.ts", "src/serve/serve-helpers/static.ts"];
  for (const pattern of globs) {
    for (const rel of new Bun.Glob(pattern).scanSync(root)) files[rel] = readFileSync(join(root, rel), "utf-8");
  }
  const constants: Record<string, string> = {};
  for (const rel of new Bun.Glob("src/**/*.ts").scanSync(root)) {
    for (const m of readFileSync(join(root, rel), "utf-8").matchAll(CONSTANT)) constants[m[1]!] = m[2]!;
  }
  return { files, constants };
};

/** The table rows whose first cell is a code span of `METHOD /path`. */
export const routesOnPage = (markdown: string): PageRoute[] => {
  const rows: PageRoute[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const route = /^`([A-Z]+) (\/\S*)`$/.exec(cells[0] ?? "");
    if (!route) continue;
    rows.push({
      method: route[1]!,
      path: route[2]!,
      kind: cells[1] ?? "",
      takes: cells[2] ?? "",
      answers: cells[3] ?? "",
      madeFor: cells[4] ?? "",
    });
  }
  return rows;
};

export const compareRoutes = (source: SourceRoute[], page: PageRoute[]): RouteGaps => {
  const shape = (path: string): string => wildcard(path.split("?")[0]!);
  const bySource = new Map(source.map((r) => [r.path, r.methods]));
  const rowsByPath = new Map<string, Set<string>>();
  for (const r of page) {
    const key = shape(r.path);
    rowsByPath.set(key, (rowsByPath.get(key) ?? new Set()).add(r.method));
  }

  const missingRows: string[] = [];
  for (const { path, methods } of source) {
    const have = rowsByPath.get(path);
    if (methods.length === 0) {
      if (!have) missingRows.push(path);
      continue;
    }
    for (const m of methods) if (!have?.has(m)) missingRows.push(`${m} ${path}`);
  }

  const unknownRows: string[] = [];
  const wrongMethod: string[] = [];
  for (const r of page) {
    if (r.path === FALLBACK_ROW) continue;
    const stated = bySource.get(shape(r.path));
    if (!stated) unknownRows.push(`${r.method} ${r.path}`);
    else if (stated.length > 0 && !stated.includes(r.method)) wrongMethod.push(`${r.method} ${r.path}`);
  }
  return { missingRows, unknownRows, wrongMethod };
};
