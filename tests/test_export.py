"""The browser's similarity search has to agree with similarity_engine.py."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from data_loader import current_season  # noqa: E402

NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="node not installed")
@pytest.mark.parametrize("start", [current_season() - 1, current_season()])
def test_browser_top_matches_match_python(start):
    players = ROOT / "web" / "data" / f"players_{start}.json"
    out = subprocess.run([NODE, str(ROOT / "tests" / "js_similar.mjs"), str(players)], capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    py = json.loads((ROOT / "reports" / f"top_matches_{start}.json").read_text())
    assigned = pd.read_csv(ROOT / "data" / "processed" / f"assigned_{start}.csv")

    checked = 0
    for pid, league in zip(assigned["player_id"], assigned["league"]):
        mine, theirs = js[f"{pid}|{league}"], py[f"{pid}|{league}"]
        # similarities agree rank by rank (z-scores are rounded to 4 places for the web)
        for a, b in zip(mine, theirs):
            assert a["sim"] == pytest.approx(b["sim"], abs=1e-3)
        # and the players agree too, except where two are practically tied
        for i, (a, b) in enumerate(zip(mine, theirs)):
            if a["id"] != b["id"]:
                assert abs(a["sim"] - b["sim"]) < 1e-3
        checked += 1
    assert checked == len(assigned)


def test_every_player_has_a_radar_and_a_spot_on_the_map():
    meta = json.loads((ROOT / "web" / "data" / "meta.json").read_text(encoding="utf-8"))
    for season in meta["seasons"]:
        players = json.loads((ROOT / "web" / "data" / f"players_{season['key']}.json").read_text(encoding="utf-8"))
        assert len(players) == season["players"]
        for p in players:
            assert len(p["pct"]) == len(meta["features"]) == len(p["z"]) == len(p["p90"])
            assert all(0 <= v <= 100 for v in p["pct"])
            assert 0 <= p["c"] < meta["k"]
