"""Write what the site needs into web/data/.

    meta.json            features, archetypes, map axes, seasons
    players_<year>.json  one entry per player: per 90s, z-scores for the
                         similarity search, percentiles for the radar,
                         archetype and map position

The browser does the similarity search itself (cosine on the z-scores), so
the filters can change the pool without a server. tests/test_export.py
checks it gets the same answers as similarity_engine.py.

    python export_web.py
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from data_loader import FEATURES, MIN_MINUTES, current_season, label, load_players
from roles import add_roles
from similarity_engine import MODELS, P90, PROCESSED, REPORTS, zscores

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "web" / "data"

# order matters: the radar goes round in this order, so related stats sit
# next to each other and a player's shape means something
GROUPS = [
    ("Shooting", ["goals", "xg", "shots"]),
    ("Creating", ["assists", "xa", "key_passes", "big_chances_created"]),
    ("Carrying the ball", ["dribbles", "final_third_passes"]),
    ("Winning it back", ["tackles_won", "interceptions", "recoveries"]),
    ("Defending the box", ["clearances", "aerials_won"]),
]
LABELS = {
    "goals": "Goals", "xg": "xG", "shots": "Shots",
    "assists": "Assists", "xa": "xA", "key_passes": "Key passes", "big_chances_created": "Big chances created",
    "dribbles": "Dribbles completed", "final_third_passes": "Final third passes",
    "tackles_won": "Tackles won", "interceptions": "Interceptions", "recoveries": "Ball recoveries",
    "clearances": "Clearances", "aerials_won": "Aerials won",
}
SHORT = {
    "goals": "Goals", "xg": "xG", "shots": "Shots", "assists": "Assists", "xa": "xA",
    "key_passes": "Key passes", "big_chances_created": "Big chances", "dribbles": "Dribbles",
    "final_third_passes": "Final 3rd passes", "tackles_won": "Tackles", "interceptions": "Interceptions",
    "recoveries": "Recoveries", "clearances": "Clearances", "aerials_won": "Aerials",
}
NOTES = {
    "final_third_passes": "Stands in for progressive carries, which no free source has since FBref lost its Opta data.",
    "big_chances_created": "Stands in for shot creating actions, same reason.",
}
ORDER = [f for _, fs in GROUPS for f in fs]


def low(f: str) -> str:
    # lower case for running text, but xG and xA stay as they are
    return LABELS[f] if f in ("xg", "xa") else LABELS[f].lower()


def describe(centroid: dict[str, float]) -> str:
    ranked = sorted(centroid.items(), key=lambda kv: -kv[1])
    high = [low(f) for f, v in ranked[:3] if v > 0.3]
    weak = [low(f) for f, v in ranked[::-1][:2] if v < -0.3]
    text = f"Well above average for {', '.join(high[:-1])} and {high[-1]}" if len(high) > 1 else (
        f"Well above average for {high[0]}" if high else "Close to average across the board")
    if weak:
        text += f", below average for {' and '.join(weak)}"
    return text + "."


def axis_ends(loadings: dict[str, list[float]], i: int) -> list[str]:
    pairs = sorted(((f, v[i]) for f, v in loadings.items()), key=lambda kv: kv[1])
    neg = [low(f) for f, v in pairs[:2]]
    pos = [low(f) for f, v in pairs[::-1][:2]]
    return [f"more {' and '.join(neg)}", f"more {' and '.join(pos)}"]


def players_payload(df: pd.DataFrame, assigned: pd.DataFrame, z: np.ndarray) -> list[dict]:
    # same row order as the engine wrote it; a player who switched leagues
    # mid-season is in there twice, once per league, so ids aren't unique
    assert (assigned["player_id"].to_numpy() == df["player_id"].to_numpy()).all()
    idx = [FEATURES.index(f) for f in ORDER]
    out = []
    for i, row in enumerate(df.itertuples()):
        ar = assigned.iloc[i]
        out.append(
            {
                "id": int(row.player_id),
                "name": row.player,
                "team": row.team,
                "league": row.league,
                "role": row.role,
                "pos": row.detailed if isinstance(row.detailed, str) else None,
                "min": int(row.minutes),
                "apps": int(row.appearances),
                "p90": [round(float(getattr(row, f"{f}_p90")), 3) for f in ORDER],
                "z": [round(float(z[i, j]), 4) for j in idx],
                "pct": [round(float(ar[f"pct_{f}_p90"])) for f in ORDER],
                "c": int(ar["cluster"]),
                "xy": [round(float(ar["pc1"]), 3), round(float(ar["pc2"]), 3)],
                "fit": round(float(ar["fit"]), 3),
            }
        )
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    engine = joblib.load(MODELS / "engine.joblib")
    summary = json.loads((REPORTS / "engine.json").read_text(encoding="utf-8"))
    now = current_season()

    seasons = []
    for start in (now - 1, now):
        df = add_roles(load_players(start))
        assigned = pd.read_csv(PROCESSED / f"assigned_{start}.csv")
        z = zscores(df, engine["scaler"])
        payload = players_payload(df, assigned, z)
        (OUT / f"players_{start}.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        seasons.append(
            {"key": str(start), "label": label(start), "full": start < now, "players": len(payload),
             "maxMinutes": int(df["minutes"].max())}
        )

    meta = {
        "exported": date.today().isoformat(),
        "minMinutes": MIN_MINUTES,
        "seasons": seasons,
        "features": [
            {"key": f, "label": LABELS[f], "short": SHORT[f], "group": g, "note": NOTES.get(f)}
            for g, fs in GROUPS for f in fs
        ],
        "groups": [g for g, _ in GROUPS],
        "archetypes": [
            {"id": a["id"], "name": a["name"], "size": a["size"], "examples": a["examples"],
             "roles": a["roles"], "about": describe(a["centroid"])}
            for a in summary["archetypes"]
        ],
        "k": summary["k"],
        "silhouette": summary["silhouette"],
        "fittedOn": summary["fitted_on"],
        "pca": {
            "explained": summary["pca_explained"],
            "x": axis_ends(summary["pca_loadings"], 0),
            "y": axis_ends(summary["pca_loadings"], 1),
        },
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    sizes = {p.name: round(p.stat().st_size / 1024) for p in sorted(OUT.glob("*.json"))}
    print("exported:", ", ".join(f"{k} {v}KB" for k, v in sizes.items()))
    for a in meta["archetypes"]:
        print(f"  {a['name']}: {a['about']}")
    print("  map x:", " <-> ".join(meta["pca"]["x"]), "| y:", " <-> ".join(meta["pca"]["y"]))


if __name__ == "__main__":
    main()
