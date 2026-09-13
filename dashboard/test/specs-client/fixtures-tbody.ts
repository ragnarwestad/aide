// The fake #jobrows table, extracted out of fixtures.ts.

/** One `<tr>` of the fake `#jobrows` (spec 204). Only the surface the
 *  per-group diff actually calls — an anchor's id, the class that says
 *  where a group ends, the walk to the next row, and the two mutations
 *  that replace a group's range. */
export interface FakeRow {
  html: string;
  readonly id: string;
  readonly className: string;
  readonly nextElementSibling: FakeRow | null;
  readonly parentNode: { insertAdjacentHTML(where: string, html: string): void };
  remove(): void;
  insertAdjacentHTML(where: string, html: string): void;
}

/** The rows of `#jobrows` as OBJECTS, beside the string they came from.
 *  A row the redraw left alone is the same object afterwards, which is
 *  what a test asserts with `toBe` — the property that decides whether a
 *  reader's press survives a redraw, and the one thing a string could
 *  never carry.
 *
 *  `onMutate` is what a browser does for free: the selects in a replaced
 *  row are new elements drawn from the server's answer, so the fake's
 *  own selects go back to what the server would have rendered. */
export function fakeTbody(onMutate: () => void) {
  let prefix = "";
  let suffix = "";
  let list: FakeRow[] = [];

  const attr = (html: string, name: string): string =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(html)?.[1] ?? "";

  const make = (html: string): FakeRow => {
    const row: FakeRow = {
      html,
      get id(): string {
        return attr(row.html, "id");
      },
      get className(): string {
        return attr(row.html, "class");
      },
      get nextElementSibling(): FakeRow | null {
        const at = list.indexOf(row);
        return at === -1 ? null : (list[at + 1] ?? null);
      },
      get parentNode() {
        return body;
      },
      remove(): void {
        const at = list.indexOf(row);
        if (at !== -1) list.splice(at, 1);
        onMutate();
      },
      insertAdjacentHTML(where: string, fragment: string): void {
        const at = list.indexOf(row);
        if (at === -1) return;
        list.splice(where === "beforebegin" ? at : at + 1, 0, ...cut(fragment));
        onMutate();
      },
    };
    return row;
  };

  /** A fragment of markup into rows, one per `</tr>`. */
  const cut = (html: string): FakeRow[] => {
    const out: FakeRow[] = [];
    let at = 0;
    for (;;) {
      const end = html.indexOf("</tr>", at);
      if (end === -1) break;
      out.push(make(html.slice(at, end + "</tr>".length)));
      at = end + "</tr>".length;
    }
    return out;
  };

  const body = {
    insertAdjacentHTML(where: string, fragment: string): void {
      const made = cut(fragment);
      if (where === "beforeend") list.push(...made);
      else list.unshift(...made);
      onMutate();
    },
  };

  return {
    /** The string `innerHTML` hands back — the one it was given, unless
     *  something has since moved a row. */
    html: (): string => prefix + list.map((r) => r.html).join("") + suffix,
    parse(html: string): void {
      const open = html.indexOf("<tbody>");
      const close = html.lastIndexOf("</tbody>");
      if (open === -1 || close === -1 || close < open) {
        // No table in it: the markup most of this file's tests use.
        // Kept whole, so they see the string they always saw.
        prefix = html;
        suffix = "";
        list = [];
        return;
      }
      const start = open + "<tbody>".length;
      prefix = html.slice(0, start);
      const content = html.slice(start, close);
      list = cut(content);
      // Whatever the split could not account for travels with the
      // suffix, so nothing is lost on the way back out.
      suffix = content.slice(list.map((r) => r.html).join("").length) + html.slice(close);
    },
    /** The FIRST row wearing this id, the way `getElementById` answers. */
    byId: (id: string): FakeRow | null => list.find((r) => r.id === id) ?? null,
    ids: (): string[] => list.map((r) => r.id),
  };
}
