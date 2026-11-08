// What the fake document needs to let the bundled page script follow a
// page: the follow marker, which the answer replaces or removes, and the
// `<template>` the answer is parsed in. There is no `window` here: the script
// does without one, and so does a page that is not scrolled or selected in.

import { Window } from "happy-dom";

interface MarkerLike {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

const fakeMarker = (attrs: Record<string, string>): MarkerLike => ({
  getAttribute: (n) => attrs[n] ?? null,
  hasAttribute: (n) => n in attrs,
});

/** `attrs` is the marker's attributes, or undefined for a page that does
 *  not follow. The facade is what `document.querySelector` hands back for
 *  as long as there is a marker, so `replaceWith` and `remove` do what they
 *  do on the page's own element. */
export function followFakes(attrs: Record<string, string> | undefined) {
  const win = new Window();
  let current: MarkerLike | null = attrs ? fakeMarker({ "data-follow": "", ...attrs }) : null;
  const facade = {
    getAttribute: (n: string) => current?.getAttribute(n) ?? null,
    hasAttribute: (n: string) => current?.hasAttribute(n) ?? false,
    replaceWith: (next: MarkerLike) => void (current = next),
    remove: () => void (current = null),
  };
  return {
    /** What `document.querySelector("[data-follow]")` answers. */
    find: () => (current ? facade : null),
    createElement: (tag: string) => win.document.createElement(tag),
    /** Whether the page still carries a marker. */
    marked: () => current !== null,
  };
}
