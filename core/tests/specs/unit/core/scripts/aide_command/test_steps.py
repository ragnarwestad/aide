"""aide analyze, implement, archive, reopen and close: each queues what the
step's button on the spec's row queues, and answers in one sentence."""
import pytest

from .conftest import held_back, make_job


@pytest.mark.parametrize("step", ["analyze", "implement", "archive", "reopen"])
def test_a_step_is_queued_as_its_button_queues_it_AC_4(machine, board, step):
    board.accepts(make_job(steps=[step], model={step: "Opus"}))

    result = machine.run(step, "722")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["path"] == "/api/queue"
    assert not post["form"], "the board reads any body but JSON as a form"
    assert post["body"] == {"project": "demo", "specFolder": "722-x", "steps": [step]}


def test_an_archived_spec_is_named_by_its_bare_folder_AC_4(machine, board):
    board.accepts(make_job(specFolder="720-y", steps=["reopen"]))

    result = machine.run("reopen", "720")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["body"]["specFolder"] == "720-y"


def test_close_posts_its_reason_to_the_close_route_AC_4(machine, board):
    board.accepts(make_job(steps=["close"], model={"close": "Opus"}),
                  "/api/queue/specs/demo/722-x/close")

    result = machine.run("close", "722", "--reason", "the idea did not hold")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["path"] == "/api/queue/specs/demo/722-x/close"
    assert not post["form"]
    assert post["body"] == {"reason": "the idea did not hold"}


def test_close_without_a_reason_is_a_usage_error_AC_4(machine, board):
    result = machine.run("close", "722")

    assert result.returncode == 2
    assert board.posts() == []


def test_no_model_is_posted_unless_asked_for_AC_5(machine, board):
    board.accepts(make_job())

    result = machine.run("analyze", "722")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert "model" not in post["body"], "the board gives the step the phase's model"


def test_model_is_posted_as_given_AC_6(machine, board):
    board.accepts(make_job(steps=["implement"], model={"implement": "Sonnet"}))

    result = machine.run("implement", "722", "--model", "Sonnet")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["body"]["model"] == "Sonnet"


def test_close_with_a_model_goes_through_the_queue_with_its_reason_AC_6(machine, board):
    board.accepts(make_job(steps=["close"], model={"close": "Sonnet"}))

    result = machine.run("close", "722", "--reason", "x", "--model", "Sonnet")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["path"] == "/api/queue"
    assert post["body"] == {"project": "demo", "specFolder": "722-x", "steps": ["close"],
                            "closeReason": "x", "model": "Sonnet"}


def test_a_spec_is_named_by_number_or_folder_or_in_another_project_AC_8(machine, board):
    board.accepts(make_job())

    assert machine.run("analyze", "722").returncode == 0
    assert machine.run("analyze", "722-x").returncode == 0
    assert machine.run("analyze", "722-y", "--project", "other").returncode == 0

    bodies = [post["body"] for post in board.posts()]
    assert bodies[0] == bodies[1] == {"project": "demo", "specFolder": "722-x", "steps": ["analyze"]}
    assert bodies[2] == {"project": "other", "specFolder": "722-y", "steps": ["analyze"]}


def test_a_number_in_another_project_is_resolved_from_its_checkout_on_this_machine_AC_8(machine, board):
    other = machine.home / ".aide" / "dashboard" / "checkouts" / "other" / "code" / ".aide"
    other.mkdir(parents=True)
    (other / "config").write_text(f"AIDE_SPECS_PATH={machine.specs}\n")
    board.accepts(make_job(project="other"))

    result = machine.run("analyze", "722", "--project", "other")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["body"] == {"project": "other", "specFolder": "722-x", "steps": ["analyze"]}


def test_a_number_in_another_project_is_resolved_from_a_job_the_board_holds_AC_8(machine, board):
    board.accepts(make_job(project="other", specFolder="722-y"),
                  others=[make_job(id="job-9", project="other", specFolder="722-y")])

    result = machine.run("analyze", "722", "--project", "other")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["body"]["specFolder"] == "722-y"


def test_a_number_that_cannot_be_resolved_posts_nothing_AC_8(machine, board):
    other = machine.run("analyze", "722", "--project", "other")
    unknown = machine.run("analyze", "799")

    for result in (other, unknown):
        assert result.returncode == 1
        assert result.stderr.strip()
    assert board.posts() == []


def test_a_running_job_starts_now_and_the_sentence_has_no_link_AC_9(machine, board):
    board.accepts(make_job())

    result = machine.run("analyze", "722")

    assert result.returncode == 0, result.stderr
    [line] = result.stdout.splitlines()
    for part in ("analyze", "722-x", "Opus", "starts now"):
        assert part in line
    assert "http" not in line


WAITS = [
    ("running", {}, "starts now"),
    ("dependency", held_back("runner.dependencyNotArchived", dependency="aide:721"),
     "aide:721 to be archived"),
    ("archive", held_back("runner.archiveRunning"), "archive already running in demo"),
    ("not analyzed", held_back("runner.notAnalyzed"), "until the spec has been analyzed"),
    ("approach", held_back("runner.approachChoice"), "approach to be chosen"),
    ("usage limit", held_back("runner.usageLimitHeld", provider="Codex"), "Codex's usage limit"),
    ("usage probe", held_back("runner.usageLimitHeldProbe", provider="Codex"), "Codex's usage limit"),
    ("switched off", held_back("runner.providerSwitchedOff", provider="Codex"),
     "Codex to be switched on"),
    ("other hold", held_back("runner.somethingNew"), "held back on the board"),
    ("queued alone", {"state": "queued"}, "free place in the queue"),
    ("ended", {"state": "stopped"}, "already ended stopped"),
]


@pytest.mark.parametrize("name,fields,ending", WAITS, ids=[w[0] for w in WAITS])
def test_the_sentence_ends_with_what_the_job_waits_for_AC_9(machine, board, name, fields, ending):
    board.accepts(make_job(**fields))

    result = machine.run("analyze", "722")

    assert result.returncode == 0, result.stderr
    [line] = result.stdout.splitlines()
    assert ending in line


def test_the_sentence_names_the_ai_behind_the_model_when_the_queue_config_is_here_AC_9(machine, board):
    config = machine.home / ".aide" / "dashboard"
    config.mkdir(parents=True)
    (config / "queue-config.json").write_text(
        '{"modelChoices": {"Opus": {"model": "opus"}, "gpt-6-sol": {"tool": "codex", "model": "gpt-6-sol"}}}')
    board.accepts(make_job(model={"analyze": "Opus"}))
    claude = machine.run("analyze", "722")
    board.accepts(make_job(model={"analyze": "gpt-6-sol"}))
    codex = machine.run("analyze", "722")

    assert "Opus (claude)" in claude.stdout
    assert "gpt-6-sol (codex)" in codex.stdout


def test_a_queued_job_waits_for_the_running_job_of_the_same_spec_AC_9(machine, board):
    running = make_job(id="job-0", steps=["implement"], model={"implement": "Sonnet"})
    board.accepts(make_job(state="queued"), others=[running])

    result = machine.run("analyze", "722")

    assert result.returncode == 0, result.stderr
    [line] = result.stdout.splitlines()
    assert "implement of the same spec to finish" in line
