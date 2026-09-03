# Deploying

Where the dashboard is served from, how HTTPS is put in front of it, and what it takes to
move it to another host or run the whole thing on one machine.

## Table of contents

- [HTTPS, and the one address](#https-and-the-one-address)
- [Signing in from a proxy's own header](#signing-in-from-a-proxys-own-header)
- [Installing it as an app](#installing-it-as-an-app)
- [On a second host](#on-a-second-host)
- [Saying it once instead of every time](#saying-it-once-instead-of-every-time)
- [On one machine](#on-one-machine)

---

## HTTPS, and the one address

The dashboard is reached at `https://<serving-host>.<tailnet>.ts.net/`, and only there. The Bun server binds `127.0.0.1`
and a `tailscale serve`
proxy terminates TLS in front of it, with a certificate Tailscale issues and renews itself. Nothing in the server does
any of this — no certificate handling, no scheme awareness, no host check anywhere in
`serve.ts`.

`make install-serve` sets the proxy up, so it is not a step anybody has to remember:

```bash
tailscale serve --bg --https 443 http://127.0.0.1:8788
```

`--bg` persists the rule in tailscaled's own state, which is why this needs no launchd job of its own and is safe to
re-run — the deploy issues it again on every install.

**`BIND` has to be `127.0.0.1`, and `install-serve` refuses anything else** when the serving host has tailscale on it.
This is the one thing here with a measurement behind it: tailscaled will not proxy to the host's own
tailnet address — pointed there it hangs for 75 seconds and answers 502. `0.0.0.0` would work for the proxy but would
also open the dashboard on the house network, a door that does not exist today. Localhost closes the question. A host
with no tailscale at all gets the plain deploy it always had, with a note saying so; only the wrong `BIND` is fatal,
because that one fails silently.

Two tailnet settings had to be enabled once, both in the admin console:
**Serve**, and **HTTPS Certificates** under DNS. `TS_PORT` moves the proxy off 443 if the serving host needs that port
for something else.

Why it matters beyond a nicer URL: a service worker needs a secure context, so installing the dashboard as an app on a
phone or a desktop depends on it.

## Signing in from a proxy's own header

A `tailscale serve` proxy in front of the dashboard already knows who the reader is — it sends the signed-in user's
name as a request header on every request it forwards. `headerAuth`, an optional block in `queue-config.json`, names
that header and the identifiers allowed in it; a request carrying one of them is let in with no token and no cookie
at all:

```json
{
  "headerAuth": {
    "header": "Tailscale-User-Login",
    "users": ["alice@example.com"]
  }
}
```

**Only honoured when `BIND` is `127.0.0.1` (or `::1`).** A header from anywhere else can be set by anyone who can
reach the port, so a server bound to any other address — `0.0.0.0` included — refuses to start at all while
`headerAuth` is set, with a message naming both the header and the offending bind address. This is the same
loopback requirement "HTTPS, and the one address" above already puts on the whole deploy, so a serving host that
already binds `127.0.0.1` needs nothing further to turn this on.

**The match is exact-string, not a prefix or a domain suffix.** Some proxies carry more than the bare identifier — Google
IAP's header, for instance, prefixes it with `accounts.google.com:`. Whatever the proxy actually sends has to be the
literal string listed in `users`; a looser match (a suffix, a substring) would risk admitting more than intended, and
a wrong guess about the prefix is safer refused than silently widened.

Other proxies that send an equivalent header, for a `headerAuth` block that names theirs instead of Tailscale's:

- **oauth2-proxy** — `X-Forwarded-Email`
- **Cloudflare Access** — `Cf-Access-Authenticated-User-Email`

The token and its cookie keep working exactly as before, whether or not `headerAuth` is set — API callers and the
spec 80 emitter, which never pass through the proxy, still need one of them.

## Installing it as an app

The served dashboard is a web app you can install: Chrome and Edge offer it from the address bar, and iOS Safari from
Share → "Add to Home Screen". It then opens in a window of its own, with the mark as its icon and the page's own
background behind the title bar.

**Install it after signing in, not before.** An installed app is launched on `start_url` — `/`, with no query string —
so the token has to be in the cookie already. Open `/?token=<the token>` once in the browser, and the installed app
opens straight into the spec list. The other order gives a 401 as the app's first screen, and the fix is the same: open
it with `?token=` once.

Five routes make it work, and none of them is a file:
`/manifest.webmanifest`, `/sw.js`, `/icon-512.svg`,
`/icon-512-maskable.svg` and `/apple-touch-icon.png` are all computed in `src/render/ui/pwa.ts` and answered from memory,
so nothing has to be kept in sync with the mark by hand and nothing is published by rsync. They are the only things on
this site a page fetches rather than carries inline — a browser will not install a page whose manifest is a data URI —
and they are outside the token, because a manifest fetch that answers 401 is a page the browser will not offer to
install at all.

The service worker caches **nothing**. Every line of this dashboard is live state, and a queue served out of yesterday's
storage would be worse than no app at all: it passes every request through to the server and answers a page load with a
short "not reachable" page when the tailnet is out of reach. That is all it is for — that, and being what a browser
looks for before it offers to install anything.

None of this works over plain HTTP: a service worker needs a secure context, which is what the section above is about.
The manifest and the icons are served either way, and the tags on the page are inert until then.

## On a second host

`MINI=<host> make install-serve` clones or pulls the repo there (the clone URL comes from this checkout's own `origin`),
installs deps, renders a launchd plist and starts the job. No plist is committed:
`deploy/render-plist.ts` builds it per invocation from the target's own
`$HOME`, resolved over ssh at install time. Logs go to
`~/Library/Logs/aide-dashboard/serve.log` on that host.

**The repo it clones there is the dashboard's OWN checkout —
`~/aide-dashboard-checkouts/aide/code` — not a checkout a person edits.** That is the directory a code landing merges
into and runs
`AIDE_INSTALL_CMD` in, and the landing restarts the launchd job afterwards. Point the job anywhere else and the
restart reloads code the landing never touched — the served page then sits on old code with every row reporting
success. The path is written once in the Makefile (`MINI_REPO`) and once in
`src/git/dashboard-checkout.ts` (`dashboardCheckoutRoot`), and
`test/git/install-serve-paths.test.ts` reads both and fails if they disagree.

`install-serve` creates that checkout itself, with plain `git clone`
over ssh, so a fresh host needs neither the checkout nor a running service beforehand. Once the service boots from it,
its own periodic
`ensureDashboardCheckout` keeps it current from then on.

**An already-installed service migrates by re-running the same command.** `make install-serve` is idempotent and is
already the documented upgrade path (`deploy-serve: install-serve`) — it rewrites the plist with the new location and
restarts the job. Nothing else is needed, and the person's own checkout on that host goes back to being just a working
copy: no service reads from it, so letting it fall behind stops mattering.

**Check your `.env.deploy` for a `MINI_REPO` override before upgrading.** It is gitignored and per-machine, so a host
that names its own checkout there keeps pointing the service at that checkout — which is the exact bug above,
reintroduced for that one operator. Remove the line and let the default apply.

Everything is overridable, nothing personal is baked in:

All paths are relative to the serving host's own `$HOME`.

| Variable         | Default                              | What it is                                                        |
|------------------|--------------------------------------|-------------------------------------------------------------------|
| `MINI`           | — required                           | the ssh target                                                    |
| `PORT`           | `8788`                               | port to serve on, behind the proxy                                |
| `TS_PORT`        | `443`                                | port tailscale serve terminates TLS on                            |
| `MINI_REPO`      | `aide-dashboard-checkouts/aide/code` | the repo to clone or pull — the dashboard's own checkout          |
| `MINI_SRC`       | `$(MINI_REPO)/dashboard`             | the directory bun runs in, and what the plist points at           |
| `REMOTE_STATE`   | `aide-dashboard`                     | site, mirrors, queue state                                        |
| `REMOTE_BUN`     | `.local/share/mise/shims/bun`        | bun on that host                                                  |
| `LABEL`          | `com.aide-dashboard.serve`           | launchd job label                                                 |
| `QUEUE_PROJECTS` | `aide,aide-dashboard`                | the allowlist's first-boot seed                                   |
| `ROOT`           | unset                                | project root there (omitted when unset)                           |
| `BIND`           | unset                                | address to bind; `127.0.0.1`, or the tailscale serve step refuses |
| `CLAUDE_USAGE`   | unset                                | claude-usage URL (omitted when unset)                             |

Publishing the generated site to that host is separate:
`AIDE_DASH_HOST=<host> make publish`. Before rsyncing (with `--delete`),
`deploy/rsync-publish.sh` checks that a specific file exists under
`out/` — a guard against wiping the serving host with an empty directory. That filename is a second place the front
page's identity lives, next to the route table above: renaming which generated page is the front page means updating
this guard too, not just the route strings.

## Saying it once instead of every time

Copy `.env.deploy.example` to `.env.deploy` and fill in your own machines. The Makefile includes it, so
`make install-serve` and
`make publish` stop needing a wall of variables on the command line. The file is gitignored — which is the point: the
tracked repo names nobody's machine, and this is where yours lives instead.

## On one machine

`make serve-local` generates the site and serves `out/` from the same machine — no ssh, no rsync, no launchd, no second
host involved. `PORT=`
and an optional `ROOT=` (the directory to scan for projects) are the only knobs. This is the whole thing running in one
place.
