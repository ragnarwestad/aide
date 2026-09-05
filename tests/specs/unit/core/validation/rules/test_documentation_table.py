"""REQ-6: every page `.claude/CLAUDE.md`'s documentation table names
must exist and must carry the subject its own row claims — so a pointer
like the one this spec fixes (spec 390) cannot go stale unnoticed again.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[6]
CLAUDE_MD = ROOT / ".claude" / "CLAUDE.md"

# Connective words the Question column uses that say nothing about the
# page's subject. Short words (< 4 chars) are dropped without needing an
# entry here.
STOPWORDS = {
    "what", "how", "the", "and", "its", "every", "between", "this", "that",
    "does", "moves", "works", "start", "says", "goes", "where", "which",
    "with", "from", "another", "each", "there", "them", "than", "when",
    "adding", "whether", "verified", "layout",
}


def table_rows() -> list[tuple[str, str]]:
    content = CLAUDE_MD.read_text(encoding="utf-8")
    section = content.split("## Reading the documentation", 1)[1]
    section = section.split("\n## ", 1)[0]  # stop at the next heading
    return re.findall(r"^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|$", section, re.MULTILINE)


def keyword_stems(question: str) -> set[str]:
    words = re.findall(r"[A-Za-z']+", question.lower())
    return {w[:6] for w in words if len(w) >= 4 and w not in STOPWORDS}


@pytest.mark.validation
@pytest.mark.parametrize("question,page", table_rows())
def test_page_exists_and_carries_its_subject(question, page):
    target = ROOT / page
    assert target.is_file(), f"{page!r} (row: {question!r}) does not exist"

    content = target.read_text(encoding="utf-8").lower()
    stems = keyword_stems(question)
    assert stems, f"row {question!r} yielded no checkable keyword — widen STOPWORDS review"
    assert any(stem in content for stem in stems), (
        f"{page} does not carry the subject its row claims ({question!r}); "
        f"none of {sorted(stems)} appears in it"
    )
