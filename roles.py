"""Attackers, midfielders, defenders.

Sofascore's position groups are too coarse for comparing styles: they file
Lamine Yamal and Cole Palmer under midfielders but Saka and Vinícius under
forwards. Transfermarkt has a proper position for everyone ("Right Winger",
"Attacking Midfield", "Centre-Back"), and the dcaribou/transfermarkt-datasets
snapshot can be downloaded in one go, so players are matched to it by name
and that decides the role. Anyone who can't be matched keeps Sofascore's
group.

    python roles.py      show how the matching went
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd
from curl_cffi import requests

ROOT = Path(__file__).resolve().parent
TM_PLAYERS = ROOT / "data" / "raw" / "transfermarkt" / "players.csv.gz"
TM_URL = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/players.csv.gz"

ROLE_OF = {
    "Centre-Forward": "Attackers", "Second Striker": "Attackers",
    "Left Winger": "Attackers", "Right Winger": "Attackers",
    "Attacking Midfield": "Midfielders", "Central Midfield": "Midfielders",
    "Defensive Midfield": "Midfielders", "Left Midfield": "Midfielders", "Right Midfield": "Midfielders",
    "Centre-Back": "Defenders", "Left-Back": "Defenders", "Right-Back": "Defenders",
}
FALLBACK = {"Defender": "Defenders", "Midfielder": "Midfielders", "Forward": "Attackers"}


def _clean(text: str) -> str:
    text = str(text).translate(str.maketrans({"ø": "o", "Ø": "O", "ß": "ss", "ł": "l", "ı": "i", "æ": "ae"}))
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z ]+", " ", text).split())


def _club(text: str) -> str:
    words = [w for w in _clean(text).split() if w not in {"fc", "cf", "afc", "de", "club", "cd", "ud", "rcd", "sd", "ca"}]
    return " ".join(words)


def transfermarkt() -> pd.DataFrame:
    if not TM_PLAYERS.exists():
        TM_PLAYERS.parent.mkdir(parents=True, exist_ok=True)
        TM_PLAYERS.write_bytes(requests.get(TM_URL, timeout=120).content)
    tm = pd.read_csv(TM_PLAYERS, usecols=["player_code", "name", "current_club_name", "sub_position", "last_season"])
    tm = tm[(tm["last_season"] >= 2024) & tm["sub_position"].isin(ROLE_OF)].copy()
    tm["key"] = tm["name"].map(_clean)
    return tm


def match_positions(df: pd.DataFrame, tm: pd.DataFrame) -> pd.Series:
    """Transfermarkt sub position for each row of df, or NaN."""
    by_slug = dict(zip(tm["player_code"], tm["sub_position"]))
    counts = tm["key"].value_counts()
    by_name = dict(zip(tm.loc[tm["key"].map(counts) == 1, "key"], tm.loc[tm["key"].map(counts) == 1, "sub_position"]))

    out = []
    for row in df.itertuples():
        pos = by_slug.get(row.slug)
        if pos is None:
            pos = by_name.get(_clean(row.player))
        if pos is None:
            # last resort: similar name at the same club
            key, club = _clean(row.player), _club(row.team)
            words = set(key.split())
            best, score = None, 0.0
            for cand in tm.itertuples():
                same_club = SequenceMatcher(None, club, _club(cand.current_club_name or "")).ratio() > 0.8
                s = SequenceMatcher(None, key, cand.key).ratio()
                # "Gabriel Magalhães" vs "Gabriel", "Djené" vs "Dakonam Djené"
                cw = set(cand.key.split())
                nested = bool(cw) and (cw <= words or words <= cw)
                same_surname = key.split()[-1:] == cand.key.split()[-1:]
                if same_club and (nested or same_surname):
                    s = max(s, 0.9)
                if s > score and (s > 0.93 or (s > 0.8 and same_club)):
                    best, score = cand.sub_position, s
            pos = best
        out.append(pos)
    return pd.Series(out, index=df.index, dtype="object")


POSITIONS_CSV = ROOT / "data" / "processed" / "positions.csv"


def add_roles(df: pd.DataFrame) -> pd.DataFrame:
    """Fuzzy matching is slow, so results are kept in positions.csv and only
    players we haven't seen before get matched."""
    known = pd.read_csv(POSITIONS_CSV) if POSITIONS_CSV.exists() else pd.DataFrame(columns=["player_id", "detailed"])
    new = df[~df["player_id"].isin(known["player_id"])]
    if len(new):
        found = match_positions(new, transfermarkt())
        known = pd.concat([known, pd.DataFrame({"player_id": new["player_id"], "detailed": found})], ignore_index=True)
        known.sort_values("player_id").to_csv(POSITIONS_CSV, index=False)
    df = df.copy()
    df["detailed"] = df["player_id"].map(dict(zip(known["player_id"], known["detailed"])))
    df["role"] = df["detailed"].map(ROLE_OF).fillna(df["position"].map(FALLBACK))
    return df


if __name__ == "__main__":
    from data_loader import current_season, load_players

    for start in (current_season() - 1, current_season()):
        players = add_roles(load_players(start))
        miss = players[players["detailed"].isna()]
        print(f"{start}: {len(players) - len(miss)}/{len(players)} matched to a Transfermarkt position")
        if len(miss):
            print("  kept Sofascore's group for:", ", ".join(miss["player"].head(15)))
        print(players["role"].value_counts().to_string())
