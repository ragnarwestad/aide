"""One generation: analyze run on a case in replay's copies, the code at the case's pinned commit before its landing
and a specs repository holding only the spec's archived description, then its analysis and plan read back.

Nothing is pushed and the copies are removed whatever happens. Whatever goes wrong becomes the attempt's problem,
never the run's end.
"""
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import copies
import steps
from copies import CannotReplay
from table import Stats

FILES = {"analysis": "2-analysis.md", "plan": "3-solution.md"}


@dataclass
class Generation:
    stats: Optional[Stats] = None
    problem: Optional[str] = None
    description: str = ""
    new: dict = None  # document -> the text analyze wrote
    original: dict = None  # document -> the archived text, or None


def _read(path):
    return Path(path).read_text() if Path(path).is_file() else None


def generate(run, case, out, work):
    """Run analyze for `case` once; its log, result, stream and the two documents land in `out`."""
    out.mkdir(parents=True, exist_ok=True)
    generation = Generation()
    try:
        folder, archived = steps.find_archived(run.specs_root, case.folder)
        generation.description = (archived / "1-description.md").read_text()
        generation.original = {d: _read(archived / name) for d, name in FILES.items()}
        code_dir = copies.code_copy(run.code, re.sub("^origin/", "", run.branch), case.before, work / "code")
        specs_repo = work / "specs"
        specs_dir = copies.specs_copy(archived, folder, run.project, specs_repo, run.core, run.specs_root)
        ran = steps.run_step(run, "analyze", run.analyze, folder, code_dir, specs_dir, out)
        generation.stats = steps.stats_of(run.analyze, ran)
        if steps.ended(ran) != "completed":
            generation.problem = f"analyze ended {steps.ended(ran)}"
            return generation
        steps.land_analyze(str(specs_repo), folder)
        generation.new = {}
        for document, name in FILES.items():
            text = _read(Path(specs_dir) / folder / name)
            if text is None:
                raise CannotReplay(f"analyze left no {name}")
            (out / name).write_text(text)
            generation.new[document] = text
    except CannotReplay as error:
        generation.problem = f"cannot be generated: {error}"
    except Exception as error:  # one attempt's trouble ends that attempt, never the run
        generation.problem = f"cannot be generated: {type(error).__name__}: {error}"
    finally:
        shutil.rmtree(work, ignore_errors=True)
    if generation.problem:
        generation.new = None
    return generation
