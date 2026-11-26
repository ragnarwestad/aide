// The two writes to a job the compiler cannot hold to the queue store's
// boundary, found in a source file's text: any use of the store's raw
// `writeUnchecked` (a name only the store has), a `state` copied onto an
// object with `Object.assign`, which `readonly` does not stop, and a job literal — an object whose own keys carry
// `state` beside `stepIndex` and `permissionMode`, two fields a job must
// have and no other model carries together (a queue row has `stepIndex`
// and `state`, but no `permissionMode`). Comments and the
// contents of strings, template literals and regular expressions are
// blanked first, so neither can spell a write — save a string that is
// exactly `writeUnchecked`, the key of `queue["writeUnchecked"]`.

export type StateWrite = { kind: "write-unchecked" | "job-literal" | "assigned-state"; line: number };

const REGEX_MAY_FOLLOW = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);

/** The end of the quoted run that opens at `start`, past its closing quote. */
function quotedEnd(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === "\\") i++;
    else if (quote !== "`" && source[i] === "\n") break;
    i++;
  }
  return i + 1;
}

/** The end of the regular expression literal that opens at `start`. */
function regexEnd(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length && source[i] !== "\n") {
    const c = source[i];
    if (c === "\\") i++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i + 1;
    i++;
  }
  return i;
}

/** `source` with every comment and every string's contents turned into
 *  spaces, line breaks kept, so offsets and lines still match. */
function blanked(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let last = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    let end = -1;
    if (c === "/" && next === "/") end = source.indexOf("\n", i) === -1 ? source.length : source.indexOf("\n", i);
    else if (c === "/" && next === "*") end = source.indexOf("*/", i + 2) === -1 ? source.length : source.indexOf("*/", i + 2) + 2;
    else if (c === '"' || c === "'" || c === "`") {
      end = quotedEnd(source, i, c);
      if (source.slice(i + 1, end - 1) !== "writeUnchecked") blank(i + 1, end - 1);
      i = end;
      last = c;
      continue;
    } else if (c === "/" && (REGEX_MAY_FOLLOW.has(last) || /\breturn$/.test(source.slice(Math.max(0, i - 7), i).trimEnd()))) {
      end = regexEnd(source, i);
      blank(i + 1, end - 1);
      i = end;
      last = "/";
      continue;
    }
    if (end !== -1) {
      blank(i, end);
      i = end;
      continue;
    }
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out.join("");
}

/** The keys an object literal opening at `open` names at its own level,
 *  and where it closes. A key is a name right after `{` or `,`. */
function ownKeys(text: string, open: number): { keys: Set<string>; close: number } {
  const keys = new Set<string>();
  let depth = 0;
  let expectKey = true;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i]!;
    if (/\s/.test(c)) continue;
    if (depth === 0 && c === "}") return { keys, close: i };
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth--;
    if (depth === 0 && c === ",") { expectKey = true; continue; }
    if (depth === 0 && expectKey) {
      const name = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
      if (name) keys.add(name[0]);
    }
    if (depth > 0 || c !== ",") expectKey = false;
  }
  return { keys, close: text.length };
}

/** Where each argument of the call whose `(` is at `paren` opens an object literal. */
function argumentObjects(text: string, paren: number): number[] {
  const opens: number[] = [];
  let depth = 0;
  let argStart = true;
  for (let i = paren + 1; i < text.length; i++) {
    const c = text[i]!;
    if (/\s/.test(c)) continue;
    if (depth === 0 && c === ")") break;
    if (depth === 0 && c === "{" && argStart) opens.push(i);
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth--;
    argStart = depth === 0 && c === ",";
  }
  return opens;
}

const JOB_KEYS = ["state", "stepIndex", "permissionMode"];

const lineOf = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

export function queueStateWrites(source: string): StateWrite[] {
  const text = blanked(source);
  const writes: StateWrite[] = [];
  for (const use of text.matchAll(/(?<![\w$])writeUnchecked(?![\w$])/g)) {
    writes.push({ kind: "write-unchecked", line: lineOf(text, use.index) });
  }
  for (const call of text.matchAll(/(?<![\w$.])Object\s*\.\s*assign\s*\(/g)) {
    if (argumentObjects(text, call.index + call[0].length - 1).some((open) => ownKeys(text, open).keys.has("state"))) {
      writes.push({ kind: "assigned-state", line: lineOf(text, call.index) });
    }
  }
  for (let open = text.indexOf("{"); open !== -1; open = text.indexOf("{", open + 1)) {
    const { keys, close } = ownKeys(text, open);
    // A pattern that takes a job apart (`const { state, stepIndex } = job`) reads, not writes.
    const destructures = /^\s*=(?!=)/.test(text.slice(close + 1));
    if (JOB_KEYS.every((key) => keys.has(key)) && !destructures) {
      writes.push({ kind: "job-literal", line: lineOf(text, open) });
    }
  }
  return writes.sort((a, b) => a.line - b.line);
}
