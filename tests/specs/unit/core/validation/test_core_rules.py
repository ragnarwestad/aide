"""Validation of the rule files in core/rules/.

The `paths` frontmatter scopes a rule to matching files in Claude Code.
report-structure.md carried the glob `**/aide-reports/**`, which matched
neither the default `reports/` location nor an external reports repo —
the rule never activated via path matching (report 71 in aide-specs).
The globs must be based on the report file NAMES, which hold wherever
the reports live.
"""
import fnmatch
import re
from pathlib import Path

import pytest

RULES_DIR = Path(__file__).parents[5] / "core" / "rules"

# Paths the rule must activate for: the default in-project location and an
# external reports repo (AIDE_REPORTS_PATH).
SAMPLE_REPORT_PATHS = [
    "reports/05-PROJ-1234-slug/2-analysis.md",
    "aide-specs/71-frontmatter-and-instruction-file-support/4-status.md",
]


def rule_paths(rule_file: Path) -> list[str]:
    match = re.match(r"^---\n(.*?)\n---", rule_file.read_text(), re.DOTALL)
    if not match:
        return []
    return re.findall(r'-\s*"([^"]+)"', match.group(1))


@pytest.mark.validation
class TestReportStructureRuleScope:
    @pytest.mark.parametrize("sample", SAMPLE_REPORT_PATHS)
    def test_globs_match_report_files_wherever_they_live(self, sample):
        globs = rule_paths(RULES_DIR / "report-structure.md")
        assert globs, "report-structure.md must have paths frontmatter"
        assert any(fnmatch.fnmatch(sample, g) for g in globs), (
            f"none of the paths globs {globs} match {sample!r} — the rule "
            "never activates for the files it is about"
        )
