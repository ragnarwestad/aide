"""The files in a repository's working tree, for the checks that read the
repository's own code."""
import subprocess
from pathlib import Path


def repo_files(root, *folders):
    """Every file in the working tree that git does not ignore, committed or
    not, sorted. A new file counts before it is committed, since a step's
    tests run before its work is; a committed file deleted from the working
    tree does not count."""
    out = subprocess.run(
        ["git", "-c", "core.quotepath=false", "-C", str(root),
         "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *folders],
        capture_output=True, text=True, check=True,
    ).stdout
    return sorted({p for p in out.split("\0") if p and Path(root, p).is_file()})
