.PHONY: test test-e2e test-slow test-all generate serve-local require-host install-serve deploy-serve install-local

# Your machine's answers to the questions this Makefile refuses to guess
# — MINI, ROOT, BIND. Gitignored, because naming them here
# is exactly what spec 03 took out of the tracked files. Optional: with
# no file, every variable is still settable on the command line.
# See .env.deploy.example. Included FIRST so it wins over the `?=`
# defaults below.
-include .env.deploy

# The generated pages read this from the ENVIRONMENT (the machine name
# they show), and make does not pass its own variables to a recipe's
# shell unless told to. (A value given on make's command line is
# exported automatically; one that comes from an included file is not,
# which is the case here.)
export AIDE_DASH_HOST

# The gate a merge runs, and the one to run while working: everything
# except the browser tests below.
#
# `test/e2e` is left out because those are the only tests that can fail
# with nothing wrong. They drive a real Chromium and measure what it
# painted, so on a host running several Claude sessions and another
# suite they lose to load and stop a merge that carried no fault --
# three times on 2026-09-05, once with 201 dangling processes killed at
# the end of the run. The other four thousand only compute, and never
# noticed. They also answer a different question from the one a merge
# asks: whether the page looks right, not whether the change broke
# something.
test:
	bunx tsc --noEmit
	# Several bun processes over disjoint paths, since one process runs one
	# file at a time and `test/queue-routes` alone was four of the suite's
	# six minutes. The script holds the per-test limit, the groups and the
	# two directories that stay out; `make test-e2e` and `make test-slow`
	# are those two.
	bash scripts/run-tests.sh

# The browser tests, on their own, for a quiet machine. Run them when
# layout or the page's own behaviour changed -- they are not part of
# `test`, so a landing never runs them. CI's dashboard job does, as its
# own step after `make test`.
test-e2e:
	bun test --timeout 20000 test/e2e

# The round's own tests, on their own: each starts a real board and does
# real git work, and on a machine running other suites they lose to load
# at any per-test limit — three of them stopped 498's landing twice on
# 2026-09-19 without a fault in it. Not part of `test`, for the same
# reason the browser tests are not; CI runs them as their own step.
test-slow:
	bun test --timeout 60000 test/round

# All three, for the rare time you want the lot.
test-all: test test-slow test-e2e

generate:
	bun run src/main.ts generate

PORT ?= 8788
# Generate and serve on THIS machine: no ssh, no rsync, no launchd.
# ROOT is optional — serve.ts only needs it to build the project nav,
# and a built-in default would name someone's checkout location.
serve-local: generate
	bun run src/serve/serve.ts serve --site out --port $(PORT) $(if $(ROOT),--root $(ROOT))

# --- Serving on a second host ------------------------------------------
# MINI is the ssh target and has NO default: a deploy aimed at a machine
# nobody named is worse than a deploy that refuses to start.
# Every path below is relative to that host's own $HOME, resolved over
# ssh at install time — never assumed from this machine.
# Two paths, not one: the dashboard's source is a subdirectory of the
# aide repo (spec 85), so the thing to clone is not the thing bun runs
# in. They were the same path back when the dashboard was its own repo,
# which is why one variable used to do both jobs.
#
# The checkout the SERVICE runs from is the dashboard's OWN (spec 205),
# never a person's. A landing merges the code there and runs
# AIDE_INSTALL_CMD there, then restarts this launchd job — so a job
# pointed at somebody's `develop/aide` reloads the code the landing did
# not touch, which is exactly what happened twice on 2026-08-24 (spec
# 223). `install-serve` clones or pulls this path directly over ssh: on
# a fresh host the service is not running yet, so nothing else can
# create it first, and once it boots the service's own periodic
# `ensureDashboardCheckout` takes over keeping it current. Must match
# `dashboardCheckoutRoot(DEFAULT_DASHBOARD_CHECKOUT_ROOT, "aide")` in
# dashboard/src/dashboard-checkout.ts — kept in sync by
# test/install-serve-paths.test.ts.
MINI_REPO ?= .aide/dashboard/checkouts/aide/code
MINI_SRC ?= $(MINI_REPO)/dashboard
REMOTE_STATE ?= .aide/dashboard
# bun via the mise shim: bare `bun` is not on launchd's PATH.
REMOTE_BUN ?= .local/share/mise/shims/bun
# A project identifier, not a per-operator one.
LABEL ?= com.aide-dashboard.serve
# The BOOTSTRAP seed only. Since spec 112 the allowlist lives in
# queue-config.json on the serving host, where the Projects panel on /
# writes it — so this value is what a host with no such file yet starts
# from, and is ignored once that file has a `projects` array. Changing it
# here does not change the allowlist on a host that has one.
QUEUE_PROJECTS ?= aide
# Localhost only: the server answers on this machine alone. HTTPS and
# access from other devices are an add-on set up by hand
# (docs/hosting.md, "HTTPS and other devices").
BIND ?= 127.0.0.1
REPO_URL := $(shell git config --get remote.origin.url)
# How install-serve reaches the host: a shell there, started in its
# $HOME, and where the rendered plist is copied to. install-local points
# all three at this machine instead; every step between is the same.
ON_HOST = ssh $(MINI)
COPY_PLIST = scp -q
PLIST_DEST = $(MINI):Library/LaunchAgents/$(LABEL).plist

require-host:
	@if [ -z "$(MINI)" ]; then \
		echo "MINI is not set — name the host to deploy to" >&2; \
		echo "(example: MINI=my-server make install-serve)" >&2; \
		exit 1; \
	fi

# Deploy the server on the serving host: clone-or-pull the source,
# install deps, render and install the plist, (re)start the launchd job.
# Idempotent.
install-serve: require-host
	$(ON_HOST) 'bash -s -- $(REMOTE_BUN)' < "$(CURDIR)/deploy/check-prerequisites.sh"
	$(ON_HOST) 'if [ -d $(MINI_REPO)/.git ]; then git -C $(MINI_REPO) pull -q --ff-only; \
		else git clone -q $(REPO_URL) $(MINI_REPO); fi && \
		cd $(MINI_SRC) && ~/$(REMOTE_BUN) install --silent'
	@home=$$($(ON_HOST) 'echo $$HOME') && \
	plist=$$(mktemp -t aide-dashboard-plist) && \
	trap 'rm -f "$$plist"' EXIT && \
	bun run deploy/render-plist.ts \
		--label $(LABEL) \
		--bun-path "$$home/$(REMOTE_BUN)" \
		--script "$$home/$(MINI_SRC)/src/serve/serve.ts" \
		--working-directory "$$home/$(MINI_SRC)" \
		--log-path "$$home/Library/Logs/aide-dashboard/serve.log" \
		-- serve \
		--site "$$home/$(REMOTE_STATE)/site" \
		--port $(PORT) \
		--mirror "$$home/$(REMOTE_STATE)/aide-runs.json" \
		--queue-mirror "$$home/$(REMOTE_STATE)/aide-queue.json" \
		--result-dir "$$home/$(REMOTE_STATE)/jobs" \
		--queue-config "$$home/$(REMOTE_STATE)/queue-config.json" \
		--runner-bin "$$home/.local/bin/aide-run-spec" \
		--pdf-bin "$$home/.local/bin/aide-generate-pdf" \
		--queue-projects "$(QUEUE_PROJECTS)" \
		--root "$(if $(ROOT),$(ROOT),$$home/$(REMOTE_STATE)/projects)" \
		$(if $(BIND),--bind "$(BIND)") \
		> "$$plist" && \
	$(COPY_PLIST) "$$plist" $(PLIST_DEST)
	@# `bootout` returns before the job is gone. Bootstrapping into that
	@# gap fails with "Bootstrap failed: 5: Input/output error" and
	@# leaves NOTHING running — the old job is already dead. Measured on
	@# the 2026-08-17 move into aide/dashboard, after five earlier
	@# deploys where the old process happened to die fast enough. Wait
	@# for the label to actually disappear, and say so if it never does
	@# rather than bootstrapping into a failure.
	@# With no ROOT the projects root is the directory of links beside
	@# the checkouts, and the dashboard's own checkout is its first link.
	@# The generated pages (about.html, one per project) are written from
	@# it on every install, since the server only serves them.
	$(ON_HOST) 'set -e; mkdir -p Library/Logs/aide-dashboard $(REMOTE_STATE)/site; \
		$(if $(ROOT),,mkdir -p $(REMOTE_STATE)/projects; \
		[ -L $(REMOTE_STATE)/projects/aide ] || [ -e $(REMOTE_STATE)/projects/aide ] || ln -s "$$HOME/$(MINI_REPO)" $(REMOTE_STATE)/projects/aide;) \
		(cd $(MINI_SRC) && ~/$(REMOTE_BUN) run src/main.ts generate --root "$(if $(ROOT),$(ROOT),$$HOME/$(REMOTE_STATE)/projects)" --out "$$HOME/$(REMOTE_STATE)/site" >/dev/null); \
		launchctl bootout gui/$$(id -u)/$(LABEL) 2>/dev/null || true; \
		for i in $$(seq 1 50); do \
			launchctl print gui/$$(id -u)/$(LABEL) >/dev/null 2>&1 || break; \
			sleep 0.2; \
		done; \
		if launchctl print gui/$$(id -u)/$(LABEL) >/dev/null 2>&1; then \
			echo "$(LABEL) is still loaded after 10s — not bootstrapping over it" >&2; \
			exit 1; \
		fi; \
		launchctl bootstrap gui/$$(id -u) Library/LaunchAgents/$(LABEL).plist'

# Update an already-installed server: pull, deps, restart.
deploy-serve: install-serve

# install-serve on the machine this runs on, with no ssh: the same
# checkout, plist, launchd job and prerequisite check. MINI only names
# the host in its messages here.
install-local: MINI = this machine
install-local: ON_HOST = cd && /bin/sh -c
install-local: COPY_PLIST = mkdir -p "$$HOME/Library/LaunchAgents" && cp
install-local: PLIST_DEST = "$$HOME/Library/LaunchAgents/$(LABEL).plist"
install-local: install-serve
