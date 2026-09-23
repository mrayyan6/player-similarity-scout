"""Season stats for every outfield player, turned into per 90 numbers.

Source is Sofascore's season statistics endpoint, one query per league per
position group (that's also how we find out a player's position). Raw
responses are cached in data/raw/.

Two seasons: 2025/26 in full, and the current one so far, which is the one
that changes when the weekly refresh runs.

    python data_loader.py              fetch (current season always fresh) and build
    python data_loader.py --offline    build from the cache only
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import date
from pathlib import Path

import pandas as pd
from curl_cffi import requests

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

SOFASCORE = "https://api.sofascore.com/api/v1"
LEAGUES = {"Premier League": 17, "La Liga": 8}
POSITIONS = {"D": "Defender", "M": "Midfielder", "F": "Forward"}  # keepers are a different sport

MIN_MINUTES = 300

# Sofascore field -> our column. Progressive carries and shot creating
# actions aren't available anywhere free since FBref lost its Opta feed, so
# final third passes and big chances created stand in for them.
COUNTING = {
    "goals": "goals",
    "assists": "assists",
    "expectedGoals": "xg",
    "expectedAssists": "xa",
    "totalShots": "shots",
    "keyPasses": "key_passes",
    "bigChancesCreated": "big_chances_created",
    "successfulDribbles": "dribbles",
    "accurateFinalThirdPasses": "final_third_passes",
    "tacklesWon": "tackles_won",
    "interceptions": "interceptions",
    "ballRecovery": "recoveries",
    "clearances": "clearances",
    "aerialDuelsWon": "aerials_won",
}
EXTRA = {"minutesPlayed": "minutes", "appearances": "appearances"}
FEATURES = list(COUNTING.values())


def current_season(today: date | None = None) -> int:
    today = today or date.today()
    return today.year if today.month >= 7 else today.year - 1


def seasons() -> list[int]:
    """The last full season plus the one in progress."""
    now = current_season()
    return [now - 1, now]


def label(start: int) -> str:
    return f"{start}/{(start + 1) % 100:02d}"


_session: requests.Session | None = None


def _get_json(url: str, cache: Path, refresh: bool) -> dict:
    global _session
    if cache.exists() and not refresh:
        return json.loads(cache.read_text(encoding="utf-8"))
    if _session is None:
        # plain python clients get a 403, a browser fingerprint doesn't
        _session = requests.Session(impersonate="chrome")
    for attempt in range(4):
        resp = _session.get(url, timeout=30)
        if resp.status_code == 200:
            break
        if resp.status_code in (403, 429) or resp.status_code >= 500:
            time.sleep(5 * (attempt + 1))
            continue
        resp.raise_for_status()
    else:
        raise RuntimeError(f"gave up on {url}, last status {resp.status_code}")
    data = resp.json()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(data), encoding="utf-8")
    time.sleep(0.8)
    return data


def season_ids(tournament: int, refresh: bool) -> dict[int, int]:
    data = _get_json(f"{SOFASCORE}/unique-tournament/{tournament}/seasons", RAW / f"seasons_{tournament}.json", refresh)
    return {2000 + int(s["year"].split("/")[0]): s["id"] for s in data["seasons"]}


def fetch_season(start: int, refresh: bool = False) -> pd.DataFrame:
    fields = ",".join([*COUNTING, *EXTRA])
    rows = []
    for league, tournament in LEAGUES.items():
        sid = season_ids(tournament, refresh)[start]
        for code, position in POSITIONS.items():
            page = 0
            while True:
                url = (
                    f"{SOFASCORE}/unique-tournament/{tournament}/season/{sid}/statistics"
                    f"?limit=100&offset={page * 100}&order=-minutesPlayed&accumulation=total"
                    f"&fields={fields}&filters=position.in.{code}"
                )
                data = _get_json(url, RAW / f"{tournament}_{sid}_{code}_{page}.json", refresh)
                for r in data["results"]:
                    row = {new: r.get(old) for old, new in {**COUNTING, **EXTRA}.items()}
                    row.update(
                        player_id=r["player"]["id"],
                        player=r["player"]["name"],
                        slug=r["player"]["slug"],
                        team=r["team"]["name"],
                        league=league,
                        position=position,
                    )
                    rows.append(row)
                page += 1
                # sorted by minutes, so once a page ends below the cut the rest will too
                last = data["results"][-1]["minutesPlayed"] if data["results"] else 0
                if page >= data["pages"] or (last or 0) < MIN_MINUTES:
                    break
    df = pd.DataFrame(rows)
    df[FEATURES + ["minutes", "appearances"]] = df[FEATURES + ["minutes", "appearances"]].fillna(0)
    df["season"] = label(start)
    return df


def per_90(df: pd.DataFrame) -> pd.DataFrame:
    """Counting stats divided by minutes and scaled to a full match, so a
    rotation player and an ever-present can be compared fairly."""
    out = df[df["minutes"] >= MIN_MINUTES].copy()
    for col in FEATURES:
        out[f"{col}_p90"] = (out[col] / out["minutes"] * 90).round(4)
    # a player who changed clubs mid-season within a league appears once,
    # but just in case Sofascore ever lists them twice keep the bigger row
    out = out.sort_values("minutes", ascending=False).drop_duplicates(["player_id", "league"])
    return out.sort_values(["league", "team", "player"], kind="stable").reset_index(drop=True)


def build(refresh: bool = False, offline: bool = False, verbose: bool = True) -> dict[str, pd.DataFrame]:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    out = {}
    now = current_season()
    for start in seasons():
        # the finished season is cached for good, the live one is refetched
        try:
            raw = fetch_season(start, refresh=(refresh or start == now) and not offline)
        except RuntimeError as err:
            # Sofascore sometimes needs a breather, last week's cache will do
            print(f"couldn't refetch {label(start)} ({err}), using the cached numbers")
            raw = fetch_season(start, refresh=False)
        df = per_90(raw)
        path = PROCESSED / f"players_{start}.csv"
        df.to_csv(path, index=False)
        out[label(start)] = df
        if verbose:
            counts = df.groupby(["league", "position"]).size().unstack()
            print(f"{label(start)}: {len(df)} players with {MIN_MINUTES}+ minutes")
            print(counts.to_string())
    return out


def load_players(start: int) -> pd.DataFrame:
    return pd.read_csv(PROCESSED / f"players_{start}.csv")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--refresh", action="store_true", help="refetch the finished season too")
    parser.add_argument("--offline", action="store_true", help="use cached responses only")
    args = parser.parse_args()
    build(refresh=args.refresh, offline=args.offline)


if __name__ == "__main__":
    main()
