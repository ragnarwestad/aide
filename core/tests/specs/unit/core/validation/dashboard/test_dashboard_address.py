"""No file that writes down where the dashboard answers names one machine.

The dashboard binds loopback and answers at `http://127.0.0.1:8788` on the
serving host; HTTPS and other devices are an optional proxy, documented on
its own page (`dashboard/docs/tailscale.md`).

`dashboard/test/no-hardcoded-host.test.ts` guards files inside `dashboard/`
against naming ONE operator's machine, but `docs/ROADMAP.md` and the tailnet
host name are outside it, so they are checked here.
"""
import re

import pytest


# Every file that writes down where the dashboard answers.
ADDRESS_FILES = (
    "dashboard/README.md",
    "dashboard/docs/hosting.md",
    "dashboard/docs/tailscale.md",
    "docs/ROADMAP.md",
    ".aide/project.yaml",
)

# The two ways the serving host's real address has been written down:
# the Tailscale IP the dashboard used to answer on, and the tailnet host
# name the new certificate is issued for. Both identify one machine, and
# the second is the one this spec makes tempting to paste.
# A REAL tailnet name, not the `<tailnet>.ts.net` placeholder: the
# character before `.ts.net` has to be part of a host label for this to
# match, and a placeholder's is `>`.
OPERATOR_ADDRESS = (
    re.compile(r"100\.115\.106\.17"),
    re.compile(r"[A-Za-z0-9-]\.ts\.net", re.IGNORECASE),
)


@pytest.mark.validation
class TestNoRealAddressInTheUnguardedFiles:
    """`no-hardcoded-host.test.ts` scans dashboard/ only; the ROADMAP is outside it."""

    @pytest.mark.parametrize("relative_path", ADDRESS_FILES)
    def test_no_real_serving_address_is_named(self, workspace_root, relative_path):
        # Arrange
        text = (workspace_root / relative_path).read_text(encoding="utf-8")

        # Act & Assert
        for pattern in OPERATOR_ADDRESS:
            assert not pattern.search(text), (
                f"{relative_path} names one machine's real address "
                f"({pattern.pattern}); the repo names no host — write "
                f"https://<serving-host>... instead"
            )
