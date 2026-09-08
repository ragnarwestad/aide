// What the WYSIWYG surface does to text it did not parse as markdown.
//
// Toast UI re-serializes the WHOLE document from its ProseMirror tree on
// every `getMarkdown()`, and a text node it holds as literal text is
// written back with a backslash in front of every markdown punctuation
// character — so a `## Requirements` block pasted into the editing
// surface is saved as `\#\# Requirements`, and the heading and the
// REQ-n bullets under it are gone from the file (seen on spec 417's own
// description, 2026-09-08).
//
// That is correct for a document whose source is not markdown. These
// files ARE markdown source: someone typing `## Requirements` into a
// spec means the heading, every time. So the escapes come back out on
// the way to the textarea the form posts.
//
// Code is the one place a backslash is likely to be meant literally — a
// regex in a fenced block, a `\d` in an inline span — so fences and code
// spans are left exactly as they are.

/** CommonMark's own escapable set: only these can carry a meaning a
 *  backslash removes, so only these are unescaped. Anything else after a
 *  backslash was never an escape and is left alone. */
const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

/** A line that opens or closes a fenced block, ``` or ~~~. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Backslash-escapes out of one line, leaving inline code spans alone.
 *  A span is anything between matched runs of backticks; an unmatched
 *  backtick opens nothing, exactly as CommonMark reads it. */
function unescapeLine(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === "`") {
      // The opening run, then everything up to a run of the same length.
      let run = 0;
      while (line[i + run] === "`") run += 1;
      const ticks = "`".repeat(run);
      const close = line.indexOf(ticks, i + run);
      if (close !== -1) {
        out += line.slice(i, close + run);
        i = close + run;
        continue;
      }
      out += ticks;
      i += run;
      continue;
    }
    if (ch === "\\" && i + 1 < line.length && ESCAPABLE.includes(line[i + 1]!)) {
      out += line[i + 1]!;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** The text a Save posts: what the editor produced, with the escapes it
 *  added to literal text taken back off. Outside fenced code only. */
export function unescapeMarkdown(text: string): string {
  let fence: string | null = null;
  return text
    .split("\n")
    .map((line) => {
      const opener = FENCE.exec(line);
      if (fence) {
        // Only a run of the SAME character, at least as long, closes it.
        if (opener && opener[1]![0] === fence[0] && opener[1]!.length >= fence.length) fence = null;
        return line;
      }
      if (opener) {
        fence = opener[1]!;
        return line;
      }
      return unescapeLine(line);
    })
    .join("\n");
}
