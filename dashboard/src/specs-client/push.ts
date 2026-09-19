// The Notifications tab's control (spec 501): turn push notifications on
// or off for the device the page is open on.
//
// `pushControl` is the whole decision, written against what a browser
// hands it as plain arguments so a test can stand in for each of them;
// `bindPushPanel` below is the thin part that reads the real ones off the
// page. The order is the point: ask the device's permission BEFORE
// subscribing, clear an earlier browser subscription first (it may have
// been made under a key the server has since lost), and post to the
// server only once a subscription exists.

interface SubscriptionLike {
  endpoint: string;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

export interface PushDeps {
  /** The server's public key, base64url. */
  publicKey: string;
  /** The language this page is read in, stored with the subscription. */
  lang: string;
  supported: boolean;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  registration(): Promise<{
    pushManager: {
      getSubscription(): Promise<SubscriptionLike | null>;
      subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<SubscriptionLike>;
    };
  }>;
  post(path: string, body: unknown): Promise<{ ok: boolean }>;
}

export interface PushView {
  state: "on" | "off" | "blocked" | "unsupported";
  message: string;
}

const VIEWS: Record<string, PushView> = {
  on: { state: "on", message: "Notifications are on for this device." },
  off: { state: "off", message: "Notifications are off for this device." },
  blocked: {
    state: "blocked",
    message: "Notifications are blocked for this site. Allow them in the device's own settings, then open this tab again.",
  },
  unsupported: {
    state: "unsupported",
    message: "Notifications need the installed app on this device — add the dashboard to the Home Screen and open it from there.",
  },
  failed: { state: "off", message: "Notifications could not be turned on. Try again." },
};

const keyBytes = (key: string): Uint8Array => {
  const padded = key.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export function pushControl(deps: PushDeps) {
  const subscription = async () => (await deps.registration()).pushManager.getSubscription();

  /** Drops the device from the server and from the browser. */
  async function forget(sub: SubscriptionLike): Promise<void> {
    await deps.post("/api/push/unsubscribe", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }

  return {
    /** What the control reads when the tab opens. A device whose owner
     *  has since withdrawn the permission is unsubscribed here, so the
     *  server stops sending to it. */
    async load(): Promise<PushView> {
      if (!deps.supported) return VIEWS.unsupported!;
      try {
        const sub = await subscription();
        if (deps.permission() === "denied") {
          if (sub) await forget(sub);
          return VIEWS.blocked!;
        }
        return sub && deps.permission() === "granted" ? VIEWS.on! : VIEWS.off!;
      } catch {
        return VIEWS.off!;
      }
    },

    async turnOn(): Promise<PushView> {
      if (!deps.supported) return VIEWS.unsupported!;
      if (deps.permission() === "denied") return VIEWS.blocked!;
      let made: SubscriptionLike | undefined;
      try {
        if (deps.permission() !== "granted") {
          const answer = await deps.requestPermission();
          if (answer === "denied") return VIEWS.blocked!;
          if (answer !== "granted") return VIEWS.off!;
        }
        const manager = (await deps.registration()).pushManager;
        const old = await manager.getSubscription();
        if (old) await old.unsubscribe();
        made = await manager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(deps.publicKey) });
        const res = await deps.post("/api/push/subscribe", { ...made.toJSON(), lang: deps.lang });
        if (res.ok) return VIEWS.on!;
      } catch {
        // falls through to the cleanup below
      }
      // The server did not take it: a browser subscription nobody sends
      // to would read as On the next time this tab is opened.
      if (made) await made.unsubscribe().catch(() => {});
      return VIEWS.failed!;
    },

    async turnOff(): Promise<PushView> {
      try {
        const sub = await subscription();
        if (sub) await forget(sub);
      } catch {
        // Off is what the person asked for; a server that could not be
        // told drops the device on its next refused send.
      }
      return VIEWS.off!;
    },
  };
}

/** The real browser objects, read off the page. */
export function bindPushPanel(panel: HTMLElement): void {
  const status = panel.querySelector("[data-push-status]") as HTMLElement | null;
  const toggle = panel.querySelector("#push-toggle") as HTMLButtonElement | null;
  if (!status || !toggle) return;
  const control = pushControl({
    publicKey: panel.dataset.key ?? "",
    lang: panel.dataset.lang ?? "en",
    supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    registration: () => navigator.serviceWorker.ready as unknown as ReturnType<PushDeps["registration"]>,
    post: async (path, body) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { ok: res.ok };
    },
  });
  let state: PushView["state"] = "off";
  const show = (view: PushView) => {
    state = view.state;
    status.textContent = view.message;
    toggle.textContent = view.state === "on" ? "Turn off" : "Turn on";
    toggle.hidden = view.state === "unsupported";
    toggle.disabled = false;
  };
  toggle.addEventListener("click", () => {
    toggle.disabled = true;
    void (state === "on" ? control.turnOff() : control.turnOn()).then(show);
  });
  void control.load().then(show);
}
