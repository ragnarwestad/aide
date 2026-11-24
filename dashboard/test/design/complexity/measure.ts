// Function length, nesting depth and repeated blocks in TypeScript, and
// the comparison with the levels held for code already over a threshold.
// The scanner is a heuristic, not a parser: it only has to agree with
// itself over time, since a held level is measured by the same scanner
// that later checks it.

// Past a screenful a function nearly always does more than one job; at
// 60 lines the held list stays short enough to read.
export const MAX_LINES = 60;
// A fifth level of control blocks means a reader holds five conditions
// at once; an early return or a helper always brings it back.
export const MAX_DEPTH = 4;
// Below 8 lines, repeats are mostly idiom — imports, guard lines, a
// test's setup; at 8 what repeats is a block someone copied.
export const WINDOW = 8;

export type Measure = { lines: number; depth: number };
export type Repeat = [line: number, otherFile: string, otherLine: number];

// --- blanking comments and literals ------------------------------------------

const REGEX_BEFORE = /(?:[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await))$/;

function quoteEnd(code: string, at: number, quote: string): number {
  let j = at + 1;
  while (j < code.length && code[j] !== quote && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
  return j + 1;
}

function templateEnd(code: string, at: number): number {
  let j = at + 1;
  while (j < code.length && code[j] !== "`") {
    if (code[j] === "\\") j += 2;
    else if (code[j] === "$" && code[j + 1] === "{") j = codeEnd(code, j + 2);
    else j++;
  }
  return j + 1;
}

/** The index after the `}` closing the code that starts at `at`. */
function codeEnd(code: string, at: number): number {
  let depth = 0;
  let j = at;
  while (j < code.length) {
    const end = literalEnd(code, j);
    if (end !== j) {
      j = end;
      continue;
    }
    if (code[j] === "{") depth++;
    if (code[j] === "}" && depth-- === 0) return j + 1;
    j++;
  }
  return j;
}

function regexEnd(code: string, at: number): number {
  let j = at + 1;
  let inClass = false;
  while (j < code.length && code[j] !== "\n" && (inClass || code[j] !== "/")) {
    if (code[j] === "[") inClass = true;
    if (code[j] === "]") inClass = false;
    j += code[j] === "\\" ? 2 : 1;
  }
  j++;
  while (/[a-z]/i.test(code[j] ?? "")) j++;
  return j;
}

function regexMayStart(code: string, at: number): boolean {
  let j = at - 1;
  while (j >= 0 && (code[j] === " " || code[j] === "\t" || code[j] === "\n")) j--;
  if (j < 0) return true;
  if (!/[\w$]/.test(code[j]!)) return REGEX_BEFORE.test(code[j]!);
  return REGEX_BEFORE.test(code.slice(Math.max(0, j - 10), j + 1));
}

/** Where the comment or literal starting at `at` ends; `at` itself when none starts there. */
function literalEnd(code: string, at: number): number {
  const c = code[at];
  const next = code[at + 1];
  if (c === "/" && next === "/") {
    const end = code.indexOf("\n", at);
    return end < 0 ? code.length : end;
  }
  if (c === "/" && next === "*") {
    const end = code.indexOf("*/", at + 2);
    return end < 0 ? code.length : end + 2;
  }
  if (c === '"' || c === "'") return quoteEnd(code, at, c);
  if (c === "`") return templateEnd(code, at);
  if (c === "/" && regexMayStart(code, at)) return regexEnd(code, at);
  return at;
}

/** The source with every comment and literal turned to spaces, newlines kept. */
function blank(source: string): string {
  const out: string[] = [];
  const starts = /[/"'`]/g;
  let from = 0;
  for (let found = starts.exec(source); found; found = starts.exec(source)) {
    const end = Math.min(literalEnd(source, found.index), source.length);
    if (end === found.index) continue;
    out.push(source.slice(from, found.index), source.slice(found.index, end).replace(/[^\n]/g, " "));
    from = starts.lastIndex = end;
  }
  out.push(source.slice(from));
  return out.join("");
}

// --- functions and control blocks --------------------------------------------

type Owner = { key: string; level: number; depth: number; anonymous: number; seen: Map<string, number> };
type Frame =
  | { kind: "control" | "plain"; owner: Owner }
  | { kind: "function"; owner: Owner; startLine: number; measured: boolean };

const CONTROL = /^(?:if|for|while|switch|try|do|catch|finally|else)\b/;
const NOT_A_METHOD = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "await"]);
const METHOD =
  /^(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?\s*([\w$]+)\s*(?:<[^()]*>)?\s*\(.*\)\s*(?::\s*[^=]+)?$/s;
const ASSIGNED =
  /^(?:export\s+)?(?:default\s+)?(?:(?:const|let|var)\s+)?(?:(?:public|private|protected|static|readonly)\s+)*([\w$]+)\s*(?::[^=]*)?[=:]\s*(?:async\b|function\b|\(|<|[\w$]+\s*=>)/;
const DESCRIBE = /^(?:describe|context)(?:\.\w+)*$/;

/** The `{` that opens the `}` at `at`. */
function openingBrace(code: string, at: number): number {
  let depth = 0;
  for (let j = at; j >= 0; j--) {
    if (code[j] === "}") depth++;
    if (code[j] === "{" && --depth === 0) return j;
  }
  return 0;
}

/** Whether the `}` at `close` ends a type, such as a return type
 *  `(): { value: number } {`, rather than a block before the clause at `at`. */
function closesAType(code: string, close: number, at: number): boolean {
  if (!/^[\s>\][|&]*(?:=>)?\s*$/.test(code.slice(close + 1, at))) return false;
  return /[:<|&]$/.test(code.slice(0, openingBrace(code, close)).trimEnd());
}

/** Where the clause ending at the `{` at `at` starts: after the last `;`,
 *  `{`, `}` (or `,` when `commas`) outside brackets, or after an unclosed `(`. */
function clauseStart(code: string, at: number, commas = true): number {
  let brackets = 0;
  let angles = 0;
  for (let j = at - 1; j >= 0; j--) {
    const c = code[j]!;
    if (c === ")" || c === "]") brackets++;
    else if (c === "(" || c === "[") {
      if (brackets === 0) return j + 1;
      brackets--;
    } else if (brackets === 0) {
      if (c === ">" && code[j - 1] !== "=") angles++;
      else if (c === "<") angles = Math.max(0, angles - 1);
      else if (c === "}" && closesAType(code, j, at)) j = openingBrace(code, j);
      else if (c === ";" || c === "{" || c === "}" || (commas && c === "," && angles === 0)) return j + 1;
    }
  }
  return 0;
}

/** The call whose argument starts at `start`, and where its `(` is:
 *  `describe` in `describe("…", () => {`. */
function callee(code: string, start: number): { name: string; paren: number } {
  let j = start - 1;
  while (j > 0 && /\s/.test(code[j]!)) j--;
  if (code[j] === ",") j = clauseStart(code, j, false) - 1;
  if (code[j] !== "(") return { name: "", paren: -1 };
  return { name: /[\w$.]+$/.exec(code.slice(Math.max(0, j - 80), j).trimEnd())?.[0] ?? "", paren: j };
}

/** `test(the name)` for a callback whose call starts with a string, as a
 *  test's or a describe's does, so the key stays when another test is added
 *  before it. None for any other anonymous function. */
function callbackName(source: string, call: { name: string; paren: number }): string | undefined {
  if (!call.name) return undefined;
  const first = /^\s*(["'`])((?:\\.|(?!\1)[^\\\n])*)\1\s*,/.exec(source.slice(call.paren + 1, call.paren + 400));
  return first ? `${call.name}(${first[2]})` : undefined;
}

function classify(header: string): { kind: Frame["kind"]; name?: string } {
  if (CONTROL.test(header)) return { kind: "control" };
  // A type starts here, such as a return type: the body is the next `{`.
  if (/[:<|&]$/.test(header)) return { kind: "plain" };
  const declared = /\bfunction\b\s*\*?\s*([\w$]*)/.exec(header);
  if (declared || header.endsWith("=>")) {
    return { kind: "function", name: ASSIGNED.exec(header)?.[1] ?? (declared?.[1] || undefined) };
  }
  const method = METHOD.exec(header);
  if (method && !NOT_A_METHOD.has(method[1]!)) return { kind: "function", name: method[1] };
  return { kind: "plain" };
}

function keyFor(owner: Owner, name: string | undefined): string {
  const prefix = owner.key ? `${owner.key}.` : "";
  const base = `${prefix}${name ?? `<anonymous#${++owner.anonymous}>`}`;
  const count = (owner.seen.get(base) ?? 0) + 1;
  owner.seen.set(base, count);
  return count === 1 ? base : `${base}#${count}`;
}

function open(source: string, code: string, at: number, line: number, owner: Owner): [Frame, Owner] {
  let start = clauseStart(code, at);
  while (/\s/.test(code[start] ?? "")) start++;
  const header = code.slice(start, at).replace(/\s+/g, " ").trim();
  const { kind, name } = classify(header);
  if (kind !== "function") {
    if (kind === "control") owner.depth = Math.max(owner.depth, ++owner.level);
    return [{ kind, owner }, owner];
  }
  const startLine = line - (code.slice(start, at).match(/\n/g)?.length ?? 0);
  const call = callee(code, start);
  const key = keyFor(owner, name ?? callbackName(source, call));
  const inner: Owner = { key, level: 0, depth: 0, anonymous: 0, seen: new Map() };
  const measured = !DESCRIBE.test(call.name);
  return [{ kind, owner: inner, startLine, measured }, inner];
}

/** Every function with a body: {key: {lines, depth}}. A key is the
 *  function's name inside its enclosing function's (`outer.inner`), a
 *  callback given after a string its call and that string
 *  (`describe(group).test(a name)`), any other anonymous one
 *  `<anonymous#n>` counted within its enclosing function, and a repeated
 *  name `#2`. A `describe(` callback only groups tests, so it is
 *  not measured; what it holds is. */
export function tsFunctions(source: string): Record<string, Measure> {
  const code = blank(source);
  const found: Record<string, Measure> = {};
  const root: Owner = { key: "", level: 0, depth: 0, anonymous: 0, seen: new Map() };
  const stack: Frame[] = [];
  let line = 1;
  const marks = /[{}\n]/g;
  for (let mark = marks.exec(code); mark; mark = marks.exec(code)) {
    const c = mark[0];
    if (c === "\n") line++;
    if (c === "{") stack.push(open(source, code, mark.index, line, stack.at(-1)?.owner ?? root)[0]);
    const frame = c === "}" ? stack.pop() : undefined;
    if (frame?.kind === "control") frame.owner.level--;
    if (frame?.kind === "function" && frame.measured) {
      found[frame.owner.key] = { lines: line - frame.startLine + 1, depth: frame.owner.depth };
    }
  }
  return found;
}

// --- repeated blocks ---------------------------------------------------------

/** [line number, trimmed line] for every line that counts: not blank, not
 *  a comment, and not a line that only closes a block. */
function normalised(text: string): [number, string][] {
  const kept: [number, string][] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line || /^(?:\/\/|\/\*|\*)/.test(line) || /^[\])};,]+$/.test(line)) return;
    kept.push([index + 1, line]);
  });
  return kept;
}

/** {path: [line, other path, other line][]}: one entry per window of
 *  WINDOW normalised lines starting in the file that also appears
 *  elsewhere, so a copy is charged to both files. */
export function duplicates(files: Record<string, string>): Record<string, Repeat[]> {
  const seen = new Map<string, [string, number][]>();
  for (const path of Object.keys(files).sort()) {
    const lines = normalised(files[path]!);
    for (let start = 0; start + WINDOW <= lines.length; start++) {
      const window = lines.slice(start, start + WINDOW).map(([, text]) => text).join("\n");
      const places = seen.get(window) ?? [];
      places.push([path, lines[start]![0]]);
      seen.set(window, places);
    }
  }
  const found: Record<string, Repeat[]> = {};
  for (const places of seen.values()) {
    if (places.length < 2) continue;
    places.forEach(([path, line], index) => {
      const other = places[index === 0 ? 1 : 0]!;
      (found[path] ??= []).push([line, other[0], other[1]]);
    });
  }
  for (const repeats of Object.values(found)) repeats.sort((a, b) => a[0] - b[0]);
  return Object.fromEntries(Object.keys(found).sort().map((path) => [path, found[path]!]));
}

// --- the held comparison -----------------------------------------------------

const RULE = 'AGENTS.md, "Code health"';
const FIX = {
  lines: `split the function so each part does one job (${RULE})`,
  depth: `return early, or move the inner blocks into a helper (${RULE})`,
  duplicates: `move the repeated block into one shared helper (${RULE})`,
};
const UNIT = { lines: "lines", depth: "levels deep" };
const LIMIT = { lines: MAX_LINES, depth: MAX_DEPTH };

/** One line per function measure over its limit and not within its held
 *  level. Equal or better passes, and an entry whose function is gone
 *  is never read. */
export function functionFailures(measured: Record<string, Measure>, held: Record<string, Partial<Measure>>): string[] {
  const bad: string[] = [];
  for (const key of Object.keys(measured).sort()) {
    for (const measure of ["lines", "depth"] as const) {
      const value = measured[key]![measure];
      const recorded = held[key]?.[measure];
      if (value <= LIMIT[measure] || (recorded !== undefined && value <= recorded)) continue;
      const against = recorded === undefined ? `limit ${LIMIT[measure]}` : `recorded ${recorded}`;
      bad.push(`${key}: ${value} ${UNIT[measure]} (${against}) — ${FIX[measure]}`);
    }
  }
  return bad;
}

/** One line per file with more repeated blocks than its held level (0 unless held). */
export function duplicateFailures(found: Record<string, Repeat[]>, held: Record<string, number>): string[] {
  const bad: string[] = [];
  for (const path of Object.keys(found).sort()) {
    const repeats = found[path]!;
    const recorded = held[path] ?? 0;
    if (repeats.length <= recorded) continue;
    const [line, other, otherLine] = repeats[0]!;
    bad.push(
      `${path}: ${repeats.length} repeated blocks (held ${recorded}), the first at line ${line}, ` +
        `also at ${other}:${otherLine} — ${FIX.duplicates}`,
    );
  }
  return bad;
}
