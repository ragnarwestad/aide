/** A model choice with the model id a run reported for it, as
 *  `Opus · claude-opus-5-5`. No id shows the choice alone: the id is what
 *  the run's own log named, and where it named none there is nothing to add. */
export function withModelId(choice: string | undefined, modelId: string | undefined): string | undefined {
  if (!modelId) return choice;
  return choice ? `${choice} · ${modelId}` : modelId;
}
