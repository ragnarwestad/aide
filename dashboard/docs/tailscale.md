# Tailscale (optional)

The dashboard answers on the machine it runs on alone, at `http://127.0.0.1:8788`. Reaching it from a phone or another
computer, over HTTPS, is an add-on: this page sets it up with [Tailscale](https://tailscale.com). Nothing in the
install depends on it, and nothing here is done by an install.

## Table of contents

- [What it gives you](#what-it-gives-you)
- [Setting it up](#setting-it-up)
- [The test servers](#the-test-servers)
- [The name the dashboard answers to](#the-name-the-dashboard-answers-to)
- [Signing in with the Tailscale user](#signing-in-with-the-tailscale-user)
- [Removing it](#removing-it)

---

## What it gives you

- **HTTPS**, with a certificate Tailscale issues and renews itself, at `https://<serving-host>.<tailnet>.ts.net/`.
  Installing the dashboard as an app on a phone or a desktop needs it: a service worker needs a secure context.
- **The dashboard from every device on your tailnet**, and from nowhere else.

A `tailscale serve` proxy on the serving host terminates TLS and forwards to `http://127.0.0.1:8788`. The dashboard
does no certificate handling and has no notion of the scheme.

## Setting it up

1. Install Tailscale on the serving host and sign in.
2. In the tailnet's admin console, enable **Serve**, and **HTTPS Certificates** under DNS. Once per tailnet.
3. On the serving host, run:

   ```bash
   tailscale serve --bg --https 443 http://127.0.0.1:8788
   for p in 8801 8802 8803 8804 8805 8806; do tailscale serve --bg --https $p http://127.0.0.1:$p; done
   ```

   The first line is the dashboard, the second the test servers' ports. Use another port than 443 if the host
   already serves something there.

`--bg` keeps the rules in Tailscale's own state: they survive restarts, reinstalls and a Deploy, and are run once.

**Keep `BIND` at `127.0.0.1`, the default.** Tailscale will not proxy to the host's own tailnet address — pointed
there it hangs for 75 seconds and answers 502 — and `0.0.0.0` would also open the dashboard on the local network.

## The test servers

A test server started from the dashboard takes one of the ports 8801–8806. With the second line above, each is
reachable at `https://<serving-host>.<tailnet>.ts.net:<port>/`.

A host that exposes some of those ports but not all is refused a test server on a port it left out, since no other
device could reach it. A host that exposes none of them has not put the test servers behind Tailscale, and starts
them as before.

## The name the dashboard answers to

The dashboard refuses a request whose `Host` is not one of its own names ("Who may call it" in
[running-specs.md](running-specs.md)). On a host with Tailscale it adds the machine's Tailscale name to them, asked of
`tailscale status --json` on the first request that needs it and again every 30 seconds until it answers, and writes
the name to its log. The proxy passes the client's `Host` on, so a request through it is admitted.

## Signing in with the Tailscale user

A `tailscale serve` proxy sends the signed-in user's login as the `Tailscale-User-Login` header on every request it
forwards. `headerAuth` in `queue-config.json` can name it, as
[deploying.md, "A proxy's own header"](deploying.md#a-proxys-own-header) describes:

```json
{
  "headerAuth": {
    "header": "Tailscale-User-Login",
    "users": ["alice@example.com"]
  }
}
```

## Removing it

```bash
tailscale serve reset
```

removes every rule above. The dashboard goes back to answering on the serving host alone.
