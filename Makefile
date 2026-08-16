.PHONY: test generate publish install-serve deploy-serve

test:
	bunx tsc --noEmit
	bun test

generate:
	bun run src/main.ts generate

publish: generate
	deploy/rsync-publish.sh

MINI ?= rw-macmini-m2
MINI_SRC ?= develop/aide-dashboard
LABEL = com.ragnarwestad.aide-dashboard-serve

# Deploy the server on the mac mini: clone-or-pull the source, install
# deps, install the plist and (re)start the launchd job. Idempotent.
install-serve:
	ssh $(MINI) 'if [ -d $(MINI_SRC)/.git ]; then git -C $(MINI_SRC) pull -q --ff-only; \
		else git clone -q git@github.com:ragnarwestad/aide-dashboard.git $(MINI_SRC); fi && \
		cd $(MINI_SRC) && ~/.local/share/mise/shims/bun install --silent'
	scp -q deploy/$(LABEL).plist $(MINI):Library/LaunchAgents/
	ssh $(MINI) 'mkdir -p Library/Logs/aide-dashboard aide-dashboard/site && \
		launchctl bootout gui/$$(id -u)/$(LABEL) 2>/dev/null; \
		launchctl bootstrap gui/$$(id -u) Library/LaunchAgents/$(LABEL).plist'

# Update an already-installed server: pull, deps, restart.
deploy-serve: install-serve
