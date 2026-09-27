import type { QueueStore } from "../../queue/queue.ts";

/** The models a page may offer, from the config, in the shape every model
 *  picker takes. A Claude alias that has run also carries `ranAs`: the id its
 *  newest run reported, so an open picker can say what the alias gives today.
 *  A choice named by its own id, another tool's choice and a stand-in carry
 *  none — for those the name already is the model. */
export function modelChoiceOptions(queue: Pick<QueueStore, "defaults" | "modelIds">): {
  name: string;
  tool?: "claude" | "codex" | "opencode" | "fake-claude";
  ranAs?: string;
}[] {
  return Object.entries(queue.defaults.modelChoices ?? {}).map(([name, choice]) => {
    const ranAs = !choice.tool || choice.tool === "claude" ? queue.modelIds[name] : undefined;
    return {
      name,
      // Carried so the option can SAY which CLI it starts: two entries
      // that differ only in that would otherwise be two identical-looking
      // names in the same dropdown.
      ...(choice.tool ? { tool: choice.tool } : {}),
      ...(ranAs && ranAs !== name ? { ranAs } : {}),
    };
  });
}
