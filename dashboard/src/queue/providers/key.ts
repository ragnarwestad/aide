// The ID a new provider is stored under when none is given, made from its
// name. Imports nothing, so the Add dialog's script can fill the ID in as
// the name is typed.

/** The ID a provider is stored under when none is given: its name in lower
 *  case, letters and digits kept, every other run of characters one `-`. */
export function providerKeyFrom(name: string): string {
  const key = name
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return key || "provider";
}
