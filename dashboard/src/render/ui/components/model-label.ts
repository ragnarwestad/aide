/** A Claude model id as its reader says it: `claude-opus-5-5` is
 *  `Opus 5.5`, `claude-haiku-4-5-20251001` is `Haiku 4.5`. Undefined for an
 *  id of any other shape, which is then shown as it is. */
export function modelName(modelId: string | undefined): string | undefined {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(modelId ?? "");
  if (!m) return undefined;
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** The last word of a label, when it is the model family `name` starts
 *  with: `Claude Opus` and `opus` both end in the family of `Opus 5.5`. */
function endsInFamily(label: string, name: string): boolean {
  const last = label.split(" ").pop()!.toLowerCase();
  return last === name.split(" ")[0]!.toLowerCase();
}

/** A model choice with the model a run reported for it. A Claude id is
 *  read as its name and takes the family word's place, so `Claude Opus`
 *  that ran on `claude-opus-5-5` reads `Claude Opus 5.5`; any other id
 *  follows the choice, as `Opus · x`. No id shows the choice alone: the id
 *  is what the run's own log named, and where it named none there is
 *  nothing to add. */
export function withModelId(choice: string | undefined, modelId: string | undefined): string | undefined {
  if (!modelId) return choice;
  const name = modelName(modelId);
  if (!name) return choice ? `${choice} · ${modelId}` : modelId;
  if (!choice) return name;
  if (endsInFamily(choice, name)) return [...choice.split(" ").slice(0, -1), name].join(" ");
  return choice.toLowerCase().startsWith("claude ") ? `Claude ${name}` : name;
}

/** A picker's option: the alias, and what it gives today when it has run —
 *  `Opus 5.5` for `Opus`, rather than the alias and the id side by side. */
export function aliasLabel(alias: string, ranAs: string | undefined): string {
  if (!ranAs) return alias;
  const name = modelName(ranAs);
  if (!name) return `${alias} (${ranAs})`;
  return endsInFamily(alias, name) ? name : `${alias} (${name})`;
}
