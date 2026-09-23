"""Refetch this season's numbers, rerun the engine, push if anything moved.

Weekly Windows scheduled task. It started life as a GitHub Action, but
Sofascore answers GitHub's servers with a 403, so it runs from home.
Last season is finished and cached, only the current one is refetched;
new players get matched to a Transfermarkt position on the way.

    python refresh.py             fetch, rebuild, commit and push if it changed
    python refresh.py --no-push   leave the commit local
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG = ROOT / "refresh.log"
OUTPUTS = ["data/processed", "reports", "web/data"]
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def log(msg: str) -> None:
    stamp = f"{datetime.now():%Y-%m-%d %H:%M} {msg}"
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(stamp + "\n")
    if sys.stdout:
        print(stamp)


def sh(*args: str) -> str:
    done = subprocess.run(
        args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
        creationflags=NO_WINDOW, env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    if done.returncode:
        log(f"failed: {' '.join(args)}\n{done.stdout[-2000:]}{done.stderr[-2000:]}")
        raise SystemExit(1)
    return done.stdout.strip()


def py(*args: str) -> str:
    # the venv's console python, even when the task starts us with pythonw
    exe = Path(sys.executable).with_name("python.exe")
    return sh(str(exe if exe.exists() else sys.executable), *args)


def main() -> None:
    push = "--no-push" not in sys.argv
    log("refresh started")
    sh("git", "pull", "--ff-only")

    counts = [line for line in py("data_loader.py").splitlines() if "players with" in line]
    for line in counts:
        log(line)
    py("similarity_engine.py")
    py("export_web.py")
    py("-m", "pytest", "-q")

    changed = [line[3:] for line in sh("git", "status", "--porcelain", "--", *OUTPUTS).splitlines()]
    if all(f.endswith("meta.json") for f in changed):
        # only the export date moved, not worth a commit
        sh("git", "checkout", "--", "web/data/meta.json")
        log("nothing new this week")
        return

    sh("git", "add", *OUTPUTS)
    sh("git", "commit", "-m", f"Refresh this season's numbers {datetime.now():%Y-%m-%d}", "--", *OUTPUTS)
    if push:
        sh("git", "push")
    log(f"committed {len(changed)} files" + (" and pushed" if push else ""))


if __name__ == "__main__":
    main()
