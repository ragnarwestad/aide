export function isBoardPage(next: Document, url: URL): boolean {
  const origin = globalThis.location?.origin ?? url.origin;
  return url.origin === origin && !!next.querySelector("body > header") && !!next.querySelector("body > main");
}

/** Hand-paired with `SERVED_BY_META` in `render/ui/shell.ts`. */
const SERVED_BY_META = "aide-served-by";

/** Whether `next` was drawn by another server process than `doc`: after a
 *  Deploy, the page this script came with is older than the code serving. */
export function servedByAnother(doc: Document, next: Document): boolean {
  const servedBy = (d: Document) => d.querySelector(`meta[name="${SERVED_BY_META}"]`)?.getAttribute("content") ?? "";
  const mine = servedBy(doc);
  const theirs = servedBy(next);
  return !!mine && !!theirs && mine !== theirs;
}

function syncElement(current: Element, fresh: Element): void {
  for (const attr of Array.from(current.attributes)) current.removeAttribute(attr.name);
  for (const attr of Array.from(fresh.attributes)) current.setAttribute(attr.name, attr.value);
  current.replaceChildren(...Array.from(fresh.childNodes).map((node) => current.ownerDocument.importNode(node, true)));
}

export function placePage(doc: Document, next: Document): void {
  const header = doc.querySelector("body > header");
  const nextHeader = next.querySelector("body > header");
  const tabs = doc.querySelector("body > nav.tabbar");
  const nextTabs = next.querySelector("body > nav.tabbar");
  if (!header || !nextHeader || !doc.querySelector("body > main") || !next.querySelector("body > main")) throw new Error("not a board page");
  syncElement(header, nextHeader);
  if (tabs && nextTabs) syncElement(tabs, nextTabs);
  else if (tabs) tabs.remove();
  else if (nextTabs) header.insertAdjacentElement("afterend", doc.importNode(nextTabs, true));

  const messageClass = "row" + "msg";
  for (const old of Array.from(doc.body.querySelectorAll(`:scope > .${messageClass}, :scope > .pageloading`))) old.remove();
  const anchor = doc.querySelector("body > nav.tabbar") ?? header;
  for (const fresh of Array.from(next.body.children)) {
    if (fresh.matches("header, nav.tabbar, main, dialog, script, style, .pageloading")) continue;
    anchor.insertAdjacentElement("afterend", doc.importNode(fresh, true));
  }
  doc.querySelector("body > main")!.replaceWith(doc.importNode(next.querySelector("body > main")!, true));
  doc.title = next.title;
  doc.documentElement.lang = next.documentElement.lang;
  for (const attr of Array.from(doc.body.attributes)) if (attr.name.startsWith("data-")) doc.body.removeAttribute(attr.name);
  for (const attr of Array.from(next.body.attributes)) if (attr.name.startsWith("data-")) doc.body.setAttribute(attr.name, attr.value);
  const oldWaiting = doc.querySelector("meta[name='aide-waiting']");
  const waiting = next.querySelector("meta[name='aide-waiting']");
  if (waiting) oldWaiting?.replaceWith(doc.importNode(waiting, true)) ?? doc.head.appendChild(doc.importNode(waiting, true));
  else oldWaiting?.remove();
}
