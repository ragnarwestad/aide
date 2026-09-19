// The address of one unfolded phase, `<project>/<folder>:<step>`. A spec
// folder cannot contain `:`, so the split is unambiguous. The server reads
// the same keys off the page's query and off the event stream's, which is
// why they live in one place.

/** One phase's key. */
export const phaseKey = (project: string, specFolder: string, step: string): string =>
  `${project}/${specFolder}:${step}`;

/** The well-formed keys in a `?phases=` value (comma-separated). Anything
 *  else — a key with no spec or no step — names no phase and is dropped. */
export function parsePhaseKeys(raw: string | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const key of (raw ?? "").split(",")) {
    const colon = key.lastIndexOf(":");
    if (colon > 0 && colon < key.length - 1 && key.slice(0, colon).includes("/")) keys.add(key);
  }
  return keys;
}
