"""scripts/replay_specs/table.py: what results.md says beside its table."""
import table


def test_the_original_tests_that_failed_are_named_per_spec():
    failed = table.Row(spec="619", folder="619-a-spec", replayed=True, original=(1, 3, 0),
                       original_failed=("test/a.test.ts::shows the row", "test/b.test.ts::sorts"))
    clean = table.Row(spec="622", folder="622-b-spec", replayed=True, original=(2, 2, 0))

    text = table.render("# Replay", [failed, clean])

    assert "Original tests that failed" in text
    assert "- 619-a-spec: test/a.test.ts::shows the row; test/b.test.ts::sorts" in text
    assert "622-b-spec:" not in text.split("Original tests that failed")[1]
