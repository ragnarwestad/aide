"""Tests for core/scripts/aide-spec-overlap: compares the files a spec's
analysis will change (`### Files to change` in its 2-analysis.md) with the
same list in every other open, analysed spec of the same specs root, and
answers which specs share a file, which it has already warned about
(`### Overlapping specs`), and which of those have landed since.

No AI and no git is involved: a made-up specs root of folders, each with a
description, an analysis and a status file. A spec's phase is read the way
the runner reads it, from 4-status.md's `Workflow steps completed:` line.
"""

import json
import subprocess

import pytest

SPEC = "700-the-spec-under-analysis"
OTHER = "701-another-open-spec"
THIRD = "702-a-third-open-spec"


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-spec-overlap"


@pytest.fixture
def root(tmp_path):
    d = tmp_path / "specs"
    d.mkdir()
    return d


def analysis_text(files=None, warned=None, extra=""):
    """A 2-analysis.md: `files` under `### Files to change`, `warned`
    (`{spec: [files]}`) under `### Overlapping specs`, both inside Findings."""
    text = "# X - Analysis\n\n## Tracking info\n\n- **Task:** `x/`\n\n---\n\n## Findings\n\n### Affected files\n\nProse.\n"
    if files is not None:
        text += "\n### Files to change\n\n" + "".join(f"- `{f}`\n" for f in files)
    if warned is not None:
        text += "\n### Overlapping specs\n\n" + "".join(
            f"- `{spec}` — " + ", ".join(f"`{f}`" for f in spec_files) + "\n" for spec, spec_files in warned.items()
        )
    return text + extra


def make_spec(root, folder, files=None, phase="analyzed", warned=None, depends=None, archived=False, analysis=None):
    """A spec folder. `phase` is the step its status line says is done last:
    created, analyzed or implemented."""
    d = (root / "archive" if archived else root) / folder
    d.mkdir(parents=True)
    description = f"# {folder} - Description\n\n## Tracking info\n\n- **Task:** `{folder}/`\n"
    if depends:
        description += f"- **Depends on:** {', '.join(depends)}\n"
    (d / "1-description.md").write_text(description)
    (d / "2-analysis.md").write_text(analysis if analysis is not None else analysis_text(files, warned))
    steps = {"created": "create", "analyzed": "create, analyze", "implemented": "create, analyze, implement"}[phase]
    (d / "4-status.md").write_text(
        f"# {folder} - Status\n\n## Tracking info\n\n- **Task:** `{folder}/`\n"
        f"- **Workflow steps completed:** {steps}\n"
    )
    return d


def overlap(script, root, spec=SPEC, *extra):
    proc = subprocess.run(
        [str(script), "--specs-root", str(root), "--spec", spec, *extra], capture_output=True, text=True,
    )
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line)


def specs_named(entries):
    return {e["spec"]: e["files"] for e in entries}


def test_an_analysed_spec_sharing_a_file_is_named_with_that_file_AC_1(script, root):
    make_spec(root, SPEC, ["x.ts", "only-mine.ts"], phase="created")
    make_spec(root, OTHER, ["x.ts", "only-theirs.ts"])
    rc, out = overlap(script, root)
    assert rc == 0, out
    assert out["ok"] is True and out["exitCode"] == 0, out
    assert out["files"] == ["x.ts", "only-mine.ts"], out
    assert specs_named(out["overlaps"]) == {OTHER: ["x.ts"]}, out
    assert out["warned"] == [] and out["landed"] == [], out


def test_each_spec_is_named_with_its_own_shared_files_sorted_AC_1(script, root):
    make_spec(root, SPEC, ["z.ts", "y.ts", "x.ts"], phase="created")
    make_spec(root, THIRD, ["z.ts"])
    make_spec(root, OTHER, ["y.ts", "x.ts", "w.ts"])
    _, out = overlap(script, root)
    assert [e["spec"] for e in out["overlaps"]] == [OTHER, THIRD], out
    assert specs_named(out["overlaps"]) == {OTHER: ["x.ts", "y.ts"], THIRD: ["z.ts"]}, out


def test_a_path_is_compared_without_a_leading_dot_slash_or_a_trailing_line_range_AC_1(script, root):
    make_spec(root, SPEC, ["./a/x.ts:12", "b/y.ts"], phase="created")
    make_spec(root, OTHER, ["a/x.ts", "b/y.ts:3-9"])
    _, out = overlap(script, root)
    assert specs_named(out["overlaps"]) == {OTHER: ["a/x.ts", "b/y.ts"]}, out


def test_a_shared_markdown_file_is_not_an_overlap(script, root):
    # Five analyses stopped on one day over shared doc pages alone
    # (dashboard/docs/http-routes.md, the-specs-list.md); archive resolves
    # a conflict in a page.
    make_spec(root, SPEC, ["docs/page.md", "x.ts"], phase="created")
    make_spec(root, OTHER, ["docs/page.md"])
    make_spec(root, THIRD, ["docs/page.md", "x.ts"])
    _, out = overlap(script, root)
    assert specs_named(out["overlaps"]) == {THIRD: ["x.ts"]}, out


def test_only_the_newest_round_of_each_analysis_is_compared_AC_1(script, root):
    rounds = (
        "# X - Analysis\n\n## Findings\n\n### Files to change\n\n- `old.ts`\n"
        "\n## Round 2\n\n### Files to change\n\n- `new.ts`\n"
    )
    make_spec(root, SPEC, phase="created", analysis=rounds)
    make_spec(root, OTHER, ["old.ts"])
    _, out = overlap(script, root)
    assert out["files"] == ["new.ts"], out
    assert out["overlaps"] == [], out
    make_spec(root, THIRD, ["new.ts"])
    _, out = overlap(script, root)
    assert specs_named(out["overlaps"]) == {THIRD: ["new.ts"]}, out


def test_a_spec_without_a_files_to_change_list_is_never_named_AC_1(script, root):
    make_spec(root, SPEC, ["x.ts"], phase="created")
    make_spec(root, OTHER, None)
    _, out = overlap(script, root)
    assert out["overlaps"] == [], out


def test_a_spec_already_in_the_record_is_left_out_but_a_new_one_still_counts_AC_4(script, root):
    make_spec(root, SPEC, ["x.ts", "y.ts"], phase="created", warned={OTHER: ["x.ts"]})
    make_spec(root, OTHER, ["x.ts"])
    _, out = overlap(script, root)
    assert out["overlaps"] == [], out
    assert specs_named(out["warned"]) == {OTHER: ["x.ts"]}, out
    make_spec(root, THIRD, ["y.ts"])
    _, out = overlap(script, root)
    assert specs_named(out["overlaps"]) == {THIRD: ["y.ts"]}, out
    assert specs_named(out["warned"]) == {OTHER: ["x.ts"]}, out


def test_landed_needs_the_record_depends_on_and_an_archived_folder_AC_5(script, root):
    make_spec(root, SPEC, ["x.ts"], phase="created", warned={OTHER: ["x.ts"]}, depends=[OTHER])
    make_spec(root, OTHER, ["x.ts"], archived=True)
    _, out = overlap(script, root)
    assert [e["spec"] for e in out["landed"]] == [OTHER], out
    assert out["overlaps"] == [], out


def test_landed_reads_a_bare_number_in_depends_on_AC_5(script, root):
    make_spec(root, SPEC, ["x.ts"], phase="created", warned={OTHER: ["x.ts"]}, depends=["701"])
    make_spec(root, OTHER, ["x.ts"], archived=True)
    _, out = overlap(script, root)
    assert [e["spec"] for e in out["landed"]] == [OTHER], out


def test_landed_is_empty_when_depends_on_does_not_name_the_spec_AC_5(script, root):
    make_spec(root, SPEC, ["x.ts"], phase="created", warned={OTHER: ["x.ts"]})
    make_spec(root, OTHER, ["x.ts"], archived=True)
    _, out = overlap(script, root)
    assert out["landed"] == [], out


def test_landed_is_empty_while_the_spec_has_not_been_archived_AC_5(script, root):
    make_spec(root, SPEC, ["x.ts"], phase="created", warned={OTHER: ["x.ts"]}, depends=[OTHER])
    make_spec(root, OTHER, ["x.ts"], phase="implemented")
    _, out = overlap(script, root)
    assert out["landed"] == [], out


def test_landed_is_empty_when_the_spec_was_never_in_the_record_AC_5(script, root):
    make_spec(root, SPEC, ["x.ts"], phase="created", depends=[OTHER])
    make_spec(root, OTHER, ["x.ts"], archived=True)
    _, out = overlap(script, root)
    assert out["landed"] == [], out


def test_record_drops_an_archived_spec_and_adds_the_new_overlaps_AC_5(script, root):
    spec = make_spec(root, SPEC, ["x.ts", "y.ts"], phase="created", warned={OTHER: ["x.ts"]}, depends=[OTHER])
    make_spec(root, OTHER, ["x.ts"], archived=True)
    make_spec(root, THIRD, ["y.ts"])
    rc, out = overlap(script, root, SPEC, "--record")
    assert rc == 0, out
    text = (spec / "2-analysis.md").read_text()
    assert OTHER not in text, text
    assert THIRD in text and "y.ts" in text.split("### Overlapping specs")[1], text
    assert "### Files to change" in text and "`x.ts`" in text.split("### Overlapping specs")[0], text
    _, again = overlap(script, root)
    assert again["landed"] == [] and again["overlaps"] == [], again
    assert specs_named(again["warned"]) == {THIRD: ["y.ts"]}, again


def test_record_writes_the_overlaps_so_the_next_comparison_has_them_as_warned_AC_4(script, root):
    spec = make_spec(root, SPEC, ["x.ts", "y.ts"], phase="created")
    make_spec(root, OTHER, ["y.ts", "x.ts"])
    _, out = overlap(script, root, SPEC, "--record")
    assert specs_named(out["warned"]) == {OTHER: ["x.ts", "y.ts"]}, out
    text = (spec / "2-analysis.md").read_text()
    assert text.count("### Overlapping specs") == 1, text
    assert OTHER in text.split("### Overlapping specs")[1], text
    _, again = overlap(script, root)
    assert again["overlaps"] == [], again
    assert specs_named(again["warned"]) == {OTHER: ["x.ts", "y.ts"]}, again


def test_record_makes_the_subsection_inside_the_newest_round_AC_4(script, root):
    rounds = "# X - Analysis\n\n## Findings\n\n### Files to change\n\n- `x.ts`\n\n## Round 2\n\n### Files to change\n\n- `x.ts`\n"
    spec = make_spec(root, SPEC, phase="created", analysis=rounds)
    make_spec(root, OTHER, ["x.ts"])
    overlap(script, root, SPEC, "--record")
    text = (spec / "2-analysis.md").read_text()
    assert OTHER not in text.split("## Round 2")[0], text
    assert OTHER in text.split("## Round 2")[1], text


def test_the_analysis_is_untouched_when_nothing_is_recorded_AC_7(script, root):
    spec = make_spec(root, SPEC, ["x.ts"], phase="created")
    make_spec(root, OTHER, ["elsewhere.ts"])
    before = (spec / "2-analysis.md").read_bytes()
    _, out = overlap(script, root, SPEC, "--record")
    assert out["overlaps"] == [], out
    assert (spec / "2-analysis.md").read_bytes() == before


def test_without_record_the_analysis_is_never_written_AC_1(script, root):
    spec = make_spec(root, SPEC, ["x.ts"], phase="created")
    make_spec(root, OTHER, ["x.ts"])
    before = (spec / "2-analysis.md").read_bytes()
    overlap(script, root)
    assert (spec / "2-analysis.md").read_bytes() == before


def test_nothing_shared_answers_an_empty_overlaps_AC_7(script, root):
    make_spec(root, SPEC, ["x.ts"], phase="created")
    make_spec(root, OTHER, ["y.ts"])
    make_spec(root, THIRD, ["z.ts"], phase="implemented")
    rc, out = overlap(script, root)
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["overlaps"] == [], out
    assert out["warned"] == [] and out["landed"] == [], out


def test_a_created_spec_and_an_archived_spec_are_not_named_AC_8(script, root):
    make_spec(root, SPEC, ["x.ts"], phase="created")
    make_spec(root, OTHER, ["x.ts"], phase="created")
    make_spec(root, THIRD, ["x.ts"], archived=True)
    _, out = overlap(script, root)
    assert out["overlaps"] == [], out


def test_an_implemented_spec_that_has_not_archived_is_named_AC_8(script, root):
    make_spec(root, SPEC, ["x.ts"], phase="created")
    make_spec(root, OTHER, ["x.ts"], phase="implemented")
    _, out = overlap(script, root)
    assert specs_named(out["overlaps"]) == {OTHER: ["x.ts"]}, out


def test_the_spec_itself_and_the_wiki_folder_are_never_candidates_AC_8(script, root):
    make_spec(root, SPEC, ["x.ts"], phase="analyzed")
    make_spec(root, "wiki", ["x.ts"])
    _, out = overlap(script, root)
    assert out["overlaps"] == [], out


def test_analysis_reads_this_specs_list_and_record_from_the_given_file_AC_4(script, root, tmp_path):
    make_spec(root, SPEC, ["unrelated.ts"], phase="created")
    make_spec(root, OTHER, ["x.ts"])
    older = tmp_path / "older-analysis.md"
    older.write_text(analysis_text(["x.ts"], warned={OTHER: ["x.ts"]}))
    _, out = overlap(script, root, SPEC, "--analysis", str(older))
    assert out["files"] == ["x.ts"], out
    assert out["overlaps"] == [], out
    assert specs_named(out["warned"]) == {OTHER: ["x.ts"]}, out


def test_help_prints_the_usage(script):
    proc = subprocess.run([str(script), "--help"], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    assert "--specs-root" in proc.stdout and "--spec" in proc.stdout and "--record" in proc.stdout, proc.stdout


@pytest.mark.parametrize("args", [["--spec", SPEC], ["--specs-root", "{root}"]])
def test_a_missing_argument_is_refused_in_the_shared_json_shape(script, root, args):
    make_spec(root, SPEC, ["x.ts"], phase="created")
    argv = [a.replace("{root}", str(root)) for a in args]
    proc = subprocess.run([str(script), *argv], capture_output=True, text=True)
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert proc.returncode == 2, proc.stdout
    assert out["ok"] is False and out["exitCode"] == 2 and out["terminalReason"] == "refused", out
    assert out["error"], out


def test_a_missing_spec_folder_is_refused(script, root):
    rc, out = overlap(script, root, "799-not-there")
    assert rc == 2, out
    assert out["ok"] is False and out["terminalReason"] == "refused", out
    assert "799-not-there" in out["error"], out
