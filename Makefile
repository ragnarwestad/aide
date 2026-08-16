.PHONY: test generate publish install-serve

test:
	bunx tsc --noEmit
	bun test

generate:
	bun run src/main.ts generate

publish: generate
	deploy/rsync-publish.sh

# One-time setup of the static server on the mac mini (idempotent).
install-serve:
	scp deploy/com.ragnarwestad.aide-dashboard-serve.plist \
		rw-macmini-m2:Library/LaunchAgents/
	ssh rw-macmini-m2 'mkdir -p Library/Logs/aide-dashboard aide-dashboard/site && \
		launchctl bootout gui/$$(id -u)/com.ragnarwestad.aide-dashboard-serve 2>/dev/null; \
		launchctl bootstrap gui/$$(id -u) Library/LaunchAgents/com.ragnarwestad.aide-dashboard-serve.plist'
