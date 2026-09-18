/** The listed spelling of a model name: what the queue config offers, or
 *  the several listed spellings that differ from it only in case. */
export type ListedModel = { name: string } | { candidates: string[] };

/** An exact match wins; otherwise a single case-only match resolves to its
 *  listed spelling. Several case-only matches are a guess, so they come
 *  back as `candidates` for the caller to name in a refusal. */
export function listedModelName(names: readonly string[], name: string): ListedModel {
  if (names.includes(name)) return { name };
  const same = names.filter((n) => n.toLowerCase() === name.toLowerCase());
  return same.length === 1 ? { name: same[0]! } : { candidates: same };
}
