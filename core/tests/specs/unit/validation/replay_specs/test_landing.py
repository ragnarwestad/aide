"""scripts/replay_specs/landing.py: the commit before a spec's code landed, found from a merge, a squash or a fast-forward."""
import json

import pytest

import landing
from .conftest import archive_spec, commit, git, init_repo, land_by_merge


@pytest.fixture
def code(tmp_path):
    repo = init_repo(tmp_path / "code")
    commit(repo, {"a.txt": "a"}, "First")
    return repo


def land_by_fast_forward(repo, folder, catch_ups):
    """A branch that catches up with main `catch_ups` times and then fast-forwards into it.
    Returns the commit main had at the last catch-up and the branch tip."""
    git(repo, "checkout", "-q", "-b", f"aide/{folder}")
    commit(repo, {f"{folder}.txt": "1"}, f"Code for {folder}")
    caught_up = None
    for n in range(catch_ups):
        git(repo, "checkout", "-q", "main")
        caught_up = commit(repo, {f"main-{folder}-{n}.txt": "x"}, "Other work")
        git(repo, "checkout", "-q", f"aide/{folder}")
        git(repo, "merge", "-q", "--no-ff", "-m", f"Merge remote-tracking branch 'origin/main' into aide/{folder}", "main")
        commit(repo, {f"{folder}-{n}.txt": "2"}, f"More code for {folder}")
    tip = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--ff-only", f"aide/{folder}")
    return caught_up, tip


def test_a_merge_landing_gives_the_commit_before_whatever_catch_up_merge_names_the_folder_too_AC_1(code, tmp_path):
    before, merge = land_by_merge(code, "7-merged", {"t.py": "x"})
    archived = archive_spec(tmp_path / "specs", "7-merged")

    found = landing.find_landing(str(code), "main", "7-merged", str(archived))

    assert (found.before, found.landed) == (before, merge)


def test_a_fast_forward_gives_the_second_parent_of_the_newest_catch_up_merge_AC_1(code, tmp_path):
    caught_up, tip = land_by_fast_forward(code, "8-forward", catch_ups=2)
    archived = archive_spec(tmp_path / "specs", "8-forward", landed_tip=tip[:8], attempts=1)

    found = landing.find_landing(str(code), "main", "8-forward", str(archived))

    assert (found.before, found.landed) == (caught_up, tip)


def test_a_fast_forward_with_no_catch_up_takes_the_implement_repo_line_when_it_ran_once_AC_1(code, tmp_path):
    began = git(code, "rev-parse", "HEAD")
    _, tip = land_by_fast_forward(code, "9-plain", catch_ups=0)
    archived = archive_spec(tmp_path / "specs", "9-plain", landed_tip=tip[:8], began=began[:8], attempts=1)

    assert landing.find_landing(str(code), "main", "9-plain", str(archived)).before == began


def test_a_fast_forward_after_two_implement_attempts_cannot_tell_where_the_code_began_AC_1(code, tmp_path):
    began = git(code, "rev-parse", "HEAD")
    _, tip = land_by_fast_forward(code, "9-twice", catch_ups=0)
    archived = archive_spec(tmp_path / "specs", "9-twice", landed_tip=tip[:8], began=began[:8], attempts=2)

    with pytest.raises(landing.NoLanding, match="cannot tell where its code began"):
        landing.find_landing(str(code), "main", "9-twice", str(archived))


def test_a_squash_landing_gives_the_first_parent_of_the_commit_gh_names_AC_1(code, tmp_path, fake_gh):
    before = git(code, "rev-parse", "HEAD")
    squash = commit(code, {"feature.txt": "x"}, "Add the feature (#41)")
    fake_gh(json.dumps([{"mergeCommit": {"oid": squash}}]))
    archived = archive_spec(tmp_path / "specs", "10-squashed")

    found = landing.find_landing(str(code), "main", "10-squashed", str(archived), code_landing="pr")

    assert (found.before, found.landed) == (before, squash)


def test_a_spec_none_of_the_rules_finds_says_no_landing_of_its_code_was_found_AC_10(code, tmp_path):
    archived = archive_spec(tmp_path / "specs", "11-lost")

    with pytest.raises(landing.NoLanding, match="no landing of its code found"):
        landing.find_landing(str(code), "main", "11-lost", str(archived))
