"""scripts/replay_specs/steps.py: what a step used, as the runner's result reports it."""
import steps
from table import step_cell


def test_a_step_uses_the_tokens_and_cost_the_runner_reports_for_the_whole_step(tmp_path):
    ran = steps.StepRun(12.0, {"tokens": {"total": 4200}, "costUsd": 0.5}, tmp_path / "implement.log")

    stats = steps.stats_of(steps.Step("claude", "opus", None), ran)

    assert (stats.seconds, stats.tokens, stats.cost) == (12.0, 4200, 0.5)
    assert "4" in step_cell(stats) and "(" not in step_cell(stats)


def test_a_step_with_no_result_has_its_tokens_not_measured(tmp_path):
    stats = steps.stats_of(steps.Step("codex", "gpt", None), steps.StepRun(3.0, None, tmp_path / "analyze.log"))

    assert stats.tokens is None and stats.cost is None
