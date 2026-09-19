// The control on the Notifications tab (AC-1, AC-6), run against fakes
// of what a browser gives it: the notification permission, the push
// manager and `fetch`. What has to hold is the ORDER — ask before
// subscribing, clear the old subscription first, post only after a
// subscription exists — and that a refusal leaves nothing behind.
import { describe, expect, test } from "bun:test";
import { pushControl, type PushDeps } from "../../src/specs-client/push.ts";

const KEY = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";

interface Setup {
  permission?: NotificationPermission;
  /** What the person answers when asked. */
  answer?: NotificationPermission;
  existing?: boolean;
  supported?: boolean;
  serverOk?: boolean;
}

function device(o: Setup = {}) {
  const log: string[] = [];
  const posts: { path: string; body: unknown }[] = [];
  let permission: NotificationPermission = o.permission ?? "default";
  const makeSub = (endpoint: string) => ({
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "P", auth: "A" } }),
    unsubscribe: async () => {
      log.push(`unsubscribe ${endpoint}`);
      current = null;
      return true;
    },
  });
  let current: ReturnType<typeof makeSub> | null = o.existing ? makeSub("https://push.test/old") : null;
  const deps: PushDeps = {
    publicKey: KEY,
    lang: "nb",
    supported: o.supported ?? true,
    permission: () => permission,
    requestPermission: async () => {
      log.push("ask");
      permission = o.answer ?? "granted";
      return permission;
    },
    registration: async () => ({
      pushManager: {
        getSubscription: async () => current,
        subscribe: async (options) => {
          log.push(`subscribe ${options.userVisibleOnly} ${options.applicationServerKey.length}`);
          current = makeSub("https://push.test/new");
          return current;
        },
      },
    }),
    post: async (path, body) => {
      log.push(`post ${path}`);
      posts.push({ path, body });
      return { ok: o.serverOk ?? true };
    },
  };
  return { deps, log, posts, control: pushControl(deps), current: () => current };
}

describe("Turn on (criteria 1, 2, 4)", () => {
  test("asks first, clears an old subscription, subscribes with the server's key, then posts (criterion 1)", async () => {
    const d = device({ existing: true });
    const view = await d.control.turnOn();
    expect(d.log).toEqual(["ask", "unsubscribe https://push.test/old", "subscribe true 65", "post /api/push/subscribe"]);
    expect(d.posts[0]!.body).toEqual({ endpoint: "https://push.test/new", keys: { p256dh: "P", auth: "A" }, lang: "nb" });
    expect(view.state).toBe("on");
  });

  test("a device that blocked notifications makes no subscription and posts nothing (criterion 2)", async () => {
    const d = device({ permission: "denied" });
    const view = await d.control.turnOn();
    expect(d.log).toEqual([]);
    expect(view.state).toBe("blocked");
    expect(view.message).toContain("settings");
  });

  test("a person who answers no to the question is not subscribed either (criterion 2)", async () => {
    const d = device({ answer: "denied" });
    const view = await d.control.turnOn();
    expect(d.log).toEqual(["ask"]);
    expect(view.state).toBe("blocked");
  });

  test("a server that refuses removes the subscription just made and stays off (criterion 4)", async () => {
    const d = device({ serverOk: false });
    const view = await d.control.turnOn();
    expect(d.log.at(-1)).toBe("unsubscribe https://push.test/new");
    expect(d.current()).toBeNull();
    expect(view.state).toBe("off");
    expect(view.message).toContain("could not be turned on");
  });

  test("a subscribe that throws leaves the control off and says so (criterion 4)", async () => {
    const d = device();
    d.deps.registration = async () => {
      throw new Error("no worker");
    };
    const view = await pushControl(d.deps).turnOn();
    expect(view.state).toBe("off");
    expect(view.message).toContain("could not be turned on");
  });
});

describe("Turn off and the state on load (criteria 3, 5)", () => {
  test("unsubscribes the device, posts its endpoint, and reads Off (criterion 3)", async () => {
    const d = device({ permission: "granted", existing: true });
    const view = await d.control.turnOff();
    expect(d.posts).toEqual([{ path: "/api/push/unsubscribe", body: { endpoint: "https://push.test/old" } }]);
    expect(d.current()).toBeNull();
    expect(view.state).toBe("off");
  });

  test("a browser with no push support offers no toggle and says the installed app is needed (criterion 3)", async () => {
    const d = device({ supported: false });
    const view = await d.control.load();
    expect(view.state).toBe("unsupported");
    expect(view.message).toContain("installed app");
    expect(d.log).toEqual([]);
  });

  test("a subscribed device with permission granted reads On", async () => {
    const d = device({ permission: "granted", existing: true });
    expect((await d.control.load()).state).toBe("on");
    expect(d.posts).toEqual([]);
  });

  test("a device whose permission was withdrawn is unsubscribed on load and reads Blocked (criterion 5)", async () => {
    const d = device({ permission: "denied", existing: true });
    const view = await d.control.load();
    expect(d.posts).toEqual([{ path: "/api/push/unsubscribe", body: { endpoint: "https://push.test/old" } }]);
    expect(d.current()).toBeNull();
    expect(view.state).toBe("blocked");
  });

  test("a device that never subscribed reads Off", async () => {
    expect((await device({ permission: "default" }).control.load()).state).toBe("off");
  });
});
