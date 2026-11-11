import type { InstallResult } from "./install.ts";

export interface DeployHooks {
  installCheckout: (root: string) => Promise<InstallResult>;
  restartRegistered: () => Promise<boolean>;
  isBoard: (root: string) => boolean;
  restartWhenSettled: (o: { onWait: (landings: string[]) => void; beforeFire: () => void }) => Promise<boolean>;
}

export { installCheckout, type InstallResult } from "./install.ts";
export { createLaunchdRestart, isDashboardRoot, landingJobNames, reloadScript, restartAfterLanding, type RestartHook } from "./restart.ts";
export { servedOlder } from "./served-version.ts";
