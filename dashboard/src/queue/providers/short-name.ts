// A provider's short name: the two characters the pickers show beside its
// tool's icon. Made from the name until someone types one, and never the
// same as another provider's, compared without regard to case.

import type { Provider } from "./index.ts";

/** Two characters made from a name: the first character of each of its
 *  first two words, else the first two of its one word, in capitals. A
 *  one-word name of one character gives one (`freeShortName` adds the
 *  second). */
export function shortNameFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).map((w) => [...w]);
  const chars = words.length > 1 ? [words[0]![0]!, words[1]![0]!] : (words[0] ?? []).slice(0, 2);
  return chars.join("").toUpperCase();
}

/** The refusal for a short name a person typed, or null when it is two
 *  characters, neither of them a space or a control character. */
export function shortNameError(short: string): string | null {
  const trimmed = short.trim();
  if (!trimmed) return "A provider needs a short name of two characters";
  const chars = [...trimmed];
  return chars.length === 2 && !chars.some((c) => /[\s\u0000-\u001f\u007f]/.test(c))
    ? null
    : `A short name is two characters — ${trimmed} was given`;
}

const same = (short: string): string => short.toUpperCase();

/** A short name made from `name` that none of `taken` is: its own letters
 *  when they are free, else its first character and the first free digit,
 *  2 to 9 and then 0 and 1, and past those the first free capital letter.
 *  When every one of those is taken, the first free pair of a capital
 *  letter or digit and another. */
export function freeShortName(name: string, taken: Iterable<string>): string {
  const held = new Set([...taken].map(same));
  const own = shortNameFrom(name);
  if ([...own].length === 2 && !held.has(own)) return own;
  const first = [...own][0] ?? "P";
  for (const second of [..."2345678901", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]) {
    if (!held.has(same(first + second))) return first + second;
  }
  const chars = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
  for (const a of chars) for (const b of chars) if (!held.has(a + b)) return a + b;
  return own;
}

/** The name of the provider, other than the one under `except`, whose
 *  short name is `short` in any case; undefined when none is. */
export function shortNameHolder(providers: Record<string, Provider>, short: string, except?: string): string | undefined {
  return Object.entries(providers).find(([key, p]) => key !== except && p.short !== undefined && same(p.short) === same(short))?.[1]
    .name;
}

/** The table with a short name on every provider. A stored one claims its
 *  letters first, in config order, so a made one never takes them; a later
 *  provider whose stored letters an earlier one claimed loses them. Then
 *  each provider without one gets `freeShortName`, in config order. */
export function withShortNames(providers: Record<string, Provider>): Record<string, Provider> {
  const claimed = new Set<string>();
  const kept: Record<string, Provider> = {};
  for (const [key, p] of Object.entries(providers)) {
    const { short, ...rest } = p;
    if (short !== undefined && !shortNameError(short) && !claimed.has(same(short))) {
      claimed.add(same(short));
      kept[key] = p;
    } else {
      kept[key] = rest;
    }
  }
  const out: Record<string, Provider> = {};
  for (const [key, p] of Object.entries(kept)) {
    if (p.short !== undefined) {
      out[key] = p;
      continue;
    }
    const short = freeShortName(p.name, claimed);
    claimed.add(same(short));
    out[key] = { ...p, short };
  }
  return out;
}
