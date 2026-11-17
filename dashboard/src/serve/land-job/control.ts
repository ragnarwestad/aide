import { cancelLanding, takeLandingCancel } from "../land-branch/cancel-landing.ts";

const stopped = new Set<string>();

export function beginLand(id: string): void { stopped.delete(id); }
export function endLand(id: string): void { stopped.delete(id); takeLandingCancel(id); }

export function checkLandStop(id: string | undefined): void {
  if (id && stopped.has(id)) throw new Error("Land stopped by user");
}

export function stopLand(id: string): void {
  stopped.add(id);
  cancelLanding(id);
}
