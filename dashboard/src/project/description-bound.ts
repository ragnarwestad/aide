// How much a spec's description may hold, and which part of `1-description.md`
// counts as the description. Pure and free of `node:` imports: the server and
// the editor's browser bundle both import it, and a bundle that fails to build
// leaves the reader with the plain textarea and no word of why.

export const DESCRIPTION_MAX = 10000;

const HEADING = /^## Description[ \t]*$/;
/** The two lines that close the description in a created file: the create
 *  step's own, and the template's note. */
const isClosing = (line: string): boolean =>
  line.trim() ===
    "*This description can be edited before /aide-analyze runs.*" ||
  line.startsWith("_(This field can be edited manually");

/** The text the New spec page's Description field became: everything after
 *  the `## Description` line up to the closing line, or to the end of the file,
 *  trimmed and with line breaks folded to LF. Headings inside it (`## Problem`,
 *  `## Acceptance criteria`) are part of it. `null` for a file with no
 *  `## Description` heading, which is then not bounded. */
export function descriptionPart(fileText: string): string | null {
  const lines = fileText.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => HEADING.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(isClosing);
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}
