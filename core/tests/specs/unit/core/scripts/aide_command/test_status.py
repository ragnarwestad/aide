"""aide status: the spec's phase from its specs repository, and what its
newest job on the board is doing."""
from .conftest import held_back, make_job


def status(machine, *args):
    result = machine.run("status", "722", *args)
    return result, result.stdout.splitlines()


def test_the_phase_and_the_running_job_are_said_in_one_line_AC_7(machine, board):
    older = make_job(id="job-0", state="done", steps=["analyze"], createdAt="2026-11-06T10:00:00Z")
    newest = make_job(id="job-1", steps=["implement"], model={"implement": "Sonnet"})
    board.answer("GET", "/api/queue", {"jobs": [older, newest]})

    result, lines = status(machine)

    assert result.returncode == 0, result.stderr
    assert len(lines) == 1
    for part in ("analyzed", "implement", "Sonnet"):
        assert part in lines[0]


def test_a_spec_without_a_job_says_so_AC_7(machine, board):
    board.answer("GET", "/api/queue", {"jobs": [make_job(specFolder="721-x")]})

    result, lines = status(machine)

    assert result.returncode == 0, result.stderr
    assert "analyzed" in lines[0]
    assert "no job on the board" in lines[0]


def test_a_queued_job_names_its_wait_and_an_ended_one_how_it_ended_AC_7(machine, board):
    waiting = make_job(**held_back("runner.dependencyNotArchived", dependency="aide:721"))
    board.answer("GET", "/api/queue", {"jobs": [waiting]})
    _, lines = status(machine)
    assert "aide:721" in lines[0]

    ended = make_job(state="stopped", stopReason="tests-red", results=[{"step": "analyze", "tool": "codex"}])
    board.answer("GET", "/api/queue", {"jobs": [ended]})
    _, lines = status(machine)
    for part in ("stopped", "tests-red", "codex"):
        assert part in lines[0]


def test_the_phase_is_read_from_origin_after_a_fetch_AC_7(machine, board):
    board.answer("GET", "/api/queue", {"jobs": []})
    machine.advance_origin("722-x", ["create", "analyze", "implement"])

    result, lines = status(machine)

    assert result.returncode == 0, result.stderr
    assert "implemented" in lines[0]


def test_a_number_finds_an_origin_only_spec_without_a_job_AC_1(machine, board):
    board.answer("GET", "/api/queue", {"jobs": []})
    machine.advance_origin("814-new", ["create"])

    result = machine.run("status", "814")

    assert result.returncode == 0, result.stderr
    assert "814-new is created" in result.stdout
    assert "no job on the board" in result.stdout


def test_number_and_folder_match_for_an_origin_only_spec_AC_2(machine, board):
    board.answer("GET", "/api/queue", {"jobs": []})
    machine.advance_origin("814-new", ["create", "analyze"])

    by_number = machine.run("status", "814")
    by_folder = machine.run("status", "814-new")

    assert by_number.returncode == 0, by_number.stderr
    assert by_folder.returncode == 0, by_folder.stderr
    assert by_number.stdout == by_folder.stdout


def test_a_confirmed_missing_number_is_reported_as_missing_AC_3(machine, board):
    board.answer("GET", "/api/queue", {"jobs": []})

    result = machine.run("status", "814")

    assert result.returncode == 1
    assert "no spec numbered 814" in result.stderr
    assert "could not refresh" not in result.stderr


def test_a_stale_local_match_does_not_override_a_confirmed_origin_miss_AC_3(machine, board):
    board.answer("GET", "/api/queue", {"jobs": []})
    (machine.specs / "814-old").mkdir()

    result = machine.run("status", "814")

    assert result.returncode == 1
    assert "no spec numbered 814" in result.stderr


def test_a_number_keeps_zero_padding_when_it_finds_an_origin_only_spec_AC_1(machine, board):
    board.answer("GET", "/api/queue", {"jobs": []})
    machine.advance_origin("05-new", ["create"])

    result = machine.run("status", "5")

    assert result.returncode == 0, result.stderr
    assert "05-new is created" in result.stdout


def test_an_unavailable_refresh_is_not_reported_as_a_missing_spec_AC_4(machine, board):
    board.answer("GET", "/api/queue", {"jobs": []})
    machine.lose_origin()

    result = machine.run("status", "814")

    assert result.returncode == 1
    assert "could not refresh" in result.stderr
    assert "no spec numbered 814" not in result.stderr


def test_a_board_job_remains_the_fallback_when_origin_has_no_match_AC_3_AC_4(machine, board):
    board.answer("GET", "/api/queue", {"jobs": [make_job(specFolder="814-new")]})
    machine.lose_origin()

    result = machine.run("status", "814")

    assert result.returncode == 0, result.stderr
    assert "814-new" in result.stdout


def test_an_archived_spec_reads_as_archived_AC_5(machine, board):
    board.answer("GET", "/api/queue", {"jobs": []})

    result = machine.run("status", "720")

    assert result.returncode == 0, result.stderr
    assert "archived" in result.stdout


def test_an_origin_that_cannot_be_fetched_says_the_phase_is_this_machines_copy_AC_7(machine, board):
    board.answer("GET", "/api/queue", {"jobs": []})
    machine.lose_origin()

    result, lines = status(machine)

    assert result.returncode == 0, result.stderr
    assert "analyzed" in lines[0]
    assert "this machine's copy" in lines[0]


def test_a_project_not_checked_out_here_says_only_the_job_AC_7(machine, board):
    job = make_job(project="other", specFolder="722-y", steps=["implement"], model={"implement": "Sonnet"})
    board.answer("GET", "/api/queue", {"jobs": [job]})

    result = machine.run("status", "722-y", "--project", "other")

    assert result.returncode == 0, result.stderr
    [line] = result.stdout.splitlines()
    assert "not known here" in line
    assert "implement" in line


def test_without_a_board_status_says_so_and_names_no_skill_AC_11(no_board_machine):
    result = no_board_machine.run("status", "722")

    assert result.returncode == 3
    assert "AIDE_BOARD_URL" in result.stderr
    assert "/aide-" not in result.stderr


def test_the_phase_of_a_spec_in_another_project_comes_from_its_checkout_here_AC_5(machine, board):
    other = machine.home / ".aide" / "dashboard" / "checkouts" / "other" / "code" / ".aide"
    other.mkdir(parents=True)
    (other / "config").write_text(f"AIDE_SPECS_PATH={machine.specs}\n")
    board.answer("GET", "/api/queue", {"jobs": []})

    result = machine.run("status", "722-x", "--project", "other")

    assert result.returncode == 0, result.stderr
    assert "analyzed" in result.stdout
