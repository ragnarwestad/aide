// The Notifications tab's switch, driven in a real DOM (happy-dom) with
// fake permission, push manager and server: which position, word and
// pressability each answer gives, and the order a press moves things in
// (AC-2, AC-3, AC-4, AC-5, AC-6). `bindPushPanel` takes those objects as
// its second argument, so no browser is involved.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

let bindPushPanel: typeof import("../../src/specs-client/push.ts").bindPushPanel;
let setSwitch: typeof import("../../src/specs-client/press.ts").setSwitch;
let notificationsPanel: typeof import("../../src/render/pages/settings-page/notifications.ts").notificationsPanel;
let switchControl: typeof import("../../src/render/ui/components").switchControl;

beforeAll(async () => {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  GlobalRegistrator.register();
  ({ bindPushPanel } = await import("../../src/specs-client/push.ts"));
  ({ setSwitch } = await import("../../src/specs-client/press.ts"));
  ({ notificationsPanel } = await import("../../src/render/pages/settings-page/notifications.ts"));
  ({ switchControl } = await import("../../src/render/ui/components"));
});

afterAll(async () => {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  await GlobalRegistrator.unregister();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

type Deps = Parameters<typeof import("../../src/specs-client/push.ts").bindPushPanel>[1];

interface Fake {
  log: string[];
  subscribed: boolean;
  /** Resolves the server's pending answer. */
  answer(ok: boolean): Promise<void>;
  deps: NonNullable<Deps>;
}

function fake(o: { supported?: boolean; permission?: NotificationPermission; subscribed?: boolean; prompt?: NotificationPermission }): Fake {
  const log: string[] = [];
  let permission = o.permission ?? "default";
  let sub = o.subscribed ?? false;
  let settle: ((r: { ok: boolean }) => void) | undefined;
  const subscription = {
    endpoint: "https://push.test/1",
    toJSON: () => ({ endpoint: "https://push.test/1", keys: {} }),
    unsubscribe: async () => {
      log.push("browser-unsubscribe");
      sub = false;
      return true;
    },
  };
  return {
    log,
    get subscribed() { return sub; },
    async answer(ok) { settle?.({ ok }); await flush(); },
    deps: {
      supported: o.supported ?? true,
      permission: () => permission,
      requestPermission: async () => {
        log.push("prompt");
        permission = o.prompt ?? "granted";
        return permission;
      },
      registration: async () => ({
        pushManager: {
          getSubscription: async () => (sub ? subscription : null),
          subscribe: async () => {
            log.push("subscribe");
            sub = true;
            return subscription;
          },
        },
      }),
      post: (path) => {
        log.push(`post ${path}`);
        return new Promise((r) => { settle = r; });
      },
    },
  } as Fake;
}

function mount(f: Fake) {
  document.body.innerHTML = notificationsPanel("AAAA", "en");
  const panel = document.querySelector("[data-push-panel]") as HTMLElement;
  bindPushPanel(panel, f.deps);
  const sw = document.querySelector("#push-toggle") as HTMLButtonElement;
  const status = document.querySelector("[data-push-status]") as HTMLElement;
  const word = () => sw.querySelector(".switchword")!.textContent;
  return { sw, status, word, checked: () => sw.getAttribute("aria-checked") };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("what the switch shows for each answer about the device", () => {
  test("on: checked, On, pressable (AC-1, AC-2)", async () => {
    const m = mount(fake({ permission: "granted", subscribed: true }));
    await flush();
    expect(m.checked()).toBe("true");
    expect(m.word()).toBe("On");
    expect(m.sw.disabled).toBe(false);
  });

  test("off: unchecked, Off, pressable (AC-1, AC-2)", async () => {
    const m = mount(fake({ permission: "default" }));
    await flush();
    expect(m.checked()).toBe("false");
    expect(m.word()).toBe("Off");
    expect(m.sw.disabled).toBe(false);
  });

  test("blocked: off and unpressable, and the sentence says the site is blocked (AC-5)", async () => {
    const m = mount(fake({ permission: "denied" }));
    await flush();
    expect(m.checked()).toBe("false");
    expect(m.word()).toBe("Off");
    expect(m.sw.disabled).toBe(true);
    expect(m.status.textContent).toStartWith("Notifications are blocked for this site");
  });

  test("no push support: off, unpressable and still drawn, and the sentence says the app is needed (AC-5)", async () => {
    const m = mount(fake({ supported: false }));
    await flush();
    expect(m.checked()).toBe("false");
    expect(m.sw.disabled).toBe(true);
    expect(m.sw.hidden).toBe(false);
    expect(m.status.textContent).toStartWith("Notifications need the installed app");
  });

  test("the accessible name and role are the same in every state (AC-2)", async () => {
    const names = new Set<string | null>();
    for (const o of [{ permission: "granted" as const, subscribed: true }, { permission: "denied" as const }, { supported: false }, {}]) {
      const m = mount(fake(o));
      expect(m.sw.getAttribute("role")).toBe("switch");
      names.add(m.sw.getAttribute("aria-label"));
      await flush();
      names.add(m.sw.getAttribute("aria-label"));
    }
    expect([...names]).toEqual(["Notifications for this device"]);
  });
});

describe("a press moves the switch only once the answer is in", () => {
  test("turning on: the prompt comes before the subscription and the post; the switch waits, locked, then moves (AC-3, AC-4)", async () => {
    const f = fake({ permission: "default" });
    const m = mount(f);
    await flush();
    m.sw.click();
    await flush();
    expect(f.log).toEqual(["prompt", "subscribe", "post /api/push/subscribe"]);
    expect(m.checked()).toBe("false");
    expect(m.sw.disabled).toBe(true);
    await f.answer(true);
    expect(m.checked()).toBe("true");
    expect(m.word()).toBe("On");
    expect(m.sw.disabled).toBe(false);
  });

  test("turning off: the server is told, and the switch stays on and locked until it answers (AC-3, AC-4)", async () => {
    const f = fake({ permission: "granted", subscribed: true });
    const m = mount(f);
    await flush();
    m.sw.click();
    await flush();
    expect(f.log).toContain("post /api/push/unsubscribe");
    expect(m.checked()).toBe("true");
    expect(m.sw.disabled).toBe(true);
    await f.answer(true);
    expect(m.checked()).toBe("false");
    expect(m.sw.disabled).toBe(false);
  });

  test("a denied prompt ends off and unpressable, with the blocked sentence (AC-4)", async () => {
    const f = fake({ permission: "default", prompt: "denied" });
    const m = mount(f);
    await flush();
    m.sw.click();
    await flush();
    expect(m.checked()).toBe("false");
    expect(m.sw.disabled).toBe(true);
    expect(m.status.textContent).toStartWith("Notifications are blocked for this site");
  });

  test("a server that refuses the subscription leaves it off and pressable, with the try-again sentence (AC-4)", async () => {
    const f = fake({ permission: "default" });
    const m = mount(f);
    await flush();
    m.sw.click();
    await flush();
    await f.answer(false);
    expect(m.checked()).toBe("false");
    expect(m.sw.disabled).toBe(false);
    expect(m.status.textContent).toBe("Notifications could not be turned on. Try again.");
  });
});

describe("the switch is a component of its own (AC-6)", () => {
  test("setSwitch moves a switch drawn anywhere: position, word and pressability", () => {
    document.body.innerHTML = switchControl({ label: "Anything", onWord: "Yes", offWord: "No" });
    const el = document.querySelector("button")!;
    setSwitch(el, { checked: true, disabled: true });
    expect(el.getAttribute("aria-checked")).toBe("true");
    expect(el.querySelector(".switchword")!.textContent).toBe("Yes");
    expect(el.disabled).toBe(true);
    setSwitch(el, { checked: false, disabled: false });
    expect(el.getAttribute("aria-checked")).toBe("false");
    expect(el.querySelector(".switchword")!.textContent).toBe("No");
    expect(el.disabled).toBe(false);
  });
});
