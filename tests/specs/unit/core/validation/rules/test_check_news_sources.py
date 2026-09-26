"""The news check reads a source for every tool Aide installs for: the
list of tools is the implementations folder, so a tool added there without
a source in the check-news skill turns this red instead of going unread.
"""
import re

import pytest

# The heading each implementation's news goes under in the skill.
HEADINGS = {
    "claude-code": "Claude Code",
    "codex": "OpenAI Codex",
    "copilot": "GitHub Copilot",
    "opencode": "OpenCode",
}


def _sources(skill_text):
    """{heading: its WebFetch addresses} for Step 2's sections."""
    step = skill_text.split("## Step 2", 1)[1].split("\n## ", 1)[0]
    out = {}
    for block in re.split(r"^### ", step, flags=re.M)[1:]:
        heading, _, body = block.partition("\n")
        out[heading.strip()] = re.findall(r"WebFetch: `(https?://[^`]+)`", body)
    return out


@pytest.mark.validation
def test_every_installed_tool_has_a_news_source(workspace_root):
    tools = sorted(d.name for d in (workspace_root / "implementations").iterdir() if (d / "install.sh").is_file())
    sources = _sources((workspace_root / ".claude" / "skills" / "check-news" / "SKILL.md").read_text())
    for tool in tools:
        assert tool in HEADINGS, f"implementations/{tool} has no heading in this test's HEADINGS"
        assert sources.get(HEADINGS[tool]), f"check-news reads no source for {HEADINGS[tool]}"
