// merge-translation.mjs — the three-way merge of one translation file: a
// JSON object of messages, merged key by key rather than line by line.
//
// Two branches that each add messages to the same file add them at the same
// place — usually the end — and git's line merge calls that a conflict,
// though the two sides never disagree about a single message. Here each key
// is decided on its own:
//
//   ours == theirs  -> that value (both sides made the same change, or none)
//   ours == base    -> theirs, a deletion included (only theirs changed it)
//   theirs == base  -> ours, a deletion included (only ours changed it)
//   otherwise       -> a real conflict: exit 1, and git leaves the file
//                      conflicted exactly as it would have without this
//
// The file is written back in ours' own layout: ours' members keep their
// order and their text byte for byte, and a member only theirs has is added
// after them, in theirs' order, with theirs' text. Any file whose layout
// cannot be read back exactly — not one top-level object, a duplicate key,
// a separator that differs between members — is not merged here at all:
// exit 1, and the conflict is git's as before. A merge that could reformat
// a file the project's own formatter owns is worse than a conflict.
//
// Usage: bun merge-translation.mjs <base> <ours> <theirs>
// git's merge driver contract: the result is written to <ours>; exit 0 when
// it merged cleanly, non-zero when the file is left in conflict.

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The top-level members of one JSON object, each as its exact text, with
 *  the layout that joins them — or null when the text is not one object
 *  this can write back unchanged. */
export function readMembers(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
  } catch {
    return null;
  }
  const open = text.indexOf("{");
  const raws = [];
  const gaps = [];
  let depth = 0;
  let inString = false;
  let start = -1;
  let end = open + 1;
  let gapStart = open + 1;
  let close = -1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') {
        inString = false;
        end = i + 1;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      if (depth === 0 && start < 0) {
        start = i;
        gaps.push(text.slice(gapStart, i));
      }
      continue;
    }
    if (/\s/.test(c)) continue;
    if (c === "{" || c === "[") {
      depth++;
    } else if ((c === "}" || c === "]") && depth > 0) {
      depth--;
    } else if (depth === 0 && (c === "," || c === "}")) {
      if (start >= 0) raws.push(text.slice(start, end));
      start = -1;
      gapStart = end;
      if (c === "}") {
        close = end;
        break;
      }
      continue;
    }
    end = i + 1;
  }
  if (close < 0) return null;
  const members = [];
  const keys = new Set();
  for (const raw of raws) {
    const keyText = raw.match(/^"(?:[^"\\]|\\.)*"/)[0];
    const key = JSON.parse(keyText);
    if (keys.has(key)) return null;
    keys.add(key);
    members.push({
      key,
      raw,
      value: JSON.parse(raw.slice(keyText.length).replace(/^\s*:/, "")),
    });
  }
  // gaps[0] is what stands between `{` and the first key; every later gap
  // is the separator before a member, comma included. They must all be the
  // same, or a member added in the middle could not be spaced like the rest.
  const lead = gaps[0] ?? "";
  const between = gaps[1];
  if (gaps.slice(2).some((g) => g !== between)) return null;
  const layout = {
    head: text.slice(0, open + 1) + lead,
    between,
    tail: text.slice(close),
  };
  if (members.length > 0 && write(members, layout) !== text) return null;
  return { members, layout };
}

function write(members, layout) {
  return (
    layout.head +
    members.map((m) => m.raw).join(layout.between ?? "") +
    layout.tail
  );
}

/** Equal as JSON values, whatever the order of an object's keys. */
function same(a, b) {
  if (a === undefined || b === undefined) return a === b;
  return canonical(a) === canonical(b);
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The merged text, or null when the three cannot be merged here. */
export function mergeTranslation(baseText, oursText, theirsText) {
  const ours = readMembers(oursText);
  const theirs = readMembers(theirsText);
  // A file both sides added has no base: every key is then an addition.
  const base = baseText.trim() === "" ? { members: [] } : readMembers(baseText);
  if (!ours || !theirs || !base) return null;
  const byKey = (side) => new Map(side.members.map((m) => [m.key, m]));
  const b = byKey(base);
  const t = byKey(theirs);
  const o = byKey(ours);
  // Which side's member a key keeps: one of the two, or none (deleted).
  const decide = (key) => {
    const bv = b.get(key)?.value;
    const ov = o.get(key)?.value;
    const tv = t.get(key)?.value;
    if (same(ov, tv)) return { keep: o.get(key) };
    if (same(ov, bv)) return { keep: t.get(key) };
    if (same(tv, bv)) return { keep: o.get(key) };
    return null;
  };
  const merged = [];
  for (const key of [...o.keys(), ...[...t.keys()].filter((k) => !o.has(k))]) {
    const verdict = decide(key);
    if (!verdict) return null;
    if (verdict.keep) merged.push(verdict.keep);
  }
  // A key only base has was deleted on both sides: nothing to write.
  let layout = ours.members.length > 0 ? ours.layout : theirs.layout;
  if (layout.between === undefined) {
    // Ours has one member or none, so it shows no separator: borrow
    // theirs' or base's, which share the file's style.
    layout = {
      ...layout,
      between: theirs.layout.between ?? base.layout?.between,
    };
    if (merged.length > 1 && layout.between === undefined) return null;
  }
  return write(merged, layout);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const [basePath, oursPath, theirsPath] = process.argv.slice(2);
  if (!basePath || !oursPath || !theirsPath) {
    process.stderr.write(
      "usage: merge-translation.mjs <base> <ours> <theirs>\n",
    );
    process.exit(2);
  }
  const merged = mergeTranslation(
    readFileSync(basePath, "utf8"),
    readFileSync(oursPath, "utf8"),
    readFileSync(theirsPath, "utf8"),
  );
  if (merged === null) process.exit(1);
  writeFileSync(oursPath, merged);
}
