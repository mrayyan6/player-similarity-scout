"""Style similarity, archetypes and the 2D map.

Everything is fitted on the last full season, then the season in progress
is projected into the same space. That way an archetype means the same
thing in both seasons and a player's dot on the map is comparable.

1. StandardScaler on the per 90 features (z-scores, clipped at +-3.5 so one
   freak number from a short spell doesn't dominate)
2. Cosine similarity between every pair of players, on style alone
3. K-Means for archetypes. The role (attacker, midfielder, defender) is
   appended as a weighted one-hot first, otherwise a full-back and a
   holding midfielder who both tackle a lot end up as one blob. K is 8:
   silhouette is fairly flat from 6 to 8 and the extra clusters at 8 are
   real roles (wing-backs, creative forwards) rather than noise. The
   silhouette for every K from 5 to 8 still goes in the report.
4. Names for the clusters, by matching each centroid against a few
   hand-written style templates, one role each
5. PCA down to two dimensions for the map, in the same space K-Means sees

    python similarity_engine.py
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import StandardScaler

from data_loader import FEATURES, current_season, label, load_players
from roles import add_roles

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"
REPORTS = ROOT / "reports"
PROCESSED = ROOT / "data" / "processed"

P90 = [f"{f}_p90" for f in FEATURES]
CLIP = 3.5
K_RANGE = range(5, 9)
K = 8
ROLES = ["Attackers", "Midfielders", "Defenders"]
ROLE_WEIGHT = 2.5
SEED = 21
TOP_N = 10

# What each archetype looks like in z-score terms, and which role it
# belongs to. The weights are my own guesses, nothing fitted.
TEMPLATES = {
    "Clinical finisher": ("Attackers", {"goals": 1.0, "xg": 1.0, "shots": 1.0, "final_third_passes": -0.4}),
    "Creative forward": ("Attackers", {"xa": 1.0, "key_passes": 1.0, "big_chances_created": 1.0, "assists": 0.6}),
    "Wide dribbler": ("Attackers", {"dribbles": 1.2, "shots": 0.5, "key_passes": 0.3, "clearances": -0.3}),
    "Target forward": ("Attackers", {"aerials_won": 1.0, "goals": 0.6, "xg": 0.5, "dribbles": -0.4}),
    "Ball-winning midfielder": ("Midfielders", {"tackles_won": 1.0, "recoveries": 1.0, "interceptions": 0.7}),
    "Creative playmaker": ("Midfielders", {"final_third_passes": 1.2, "key_passes": 0.6, "xa": 0.5, "recoveries": 0.3}),
    "Box-to-box runner": ("Midfielders", {"goals": 0.4, "shots": 0.5, "tackles_won": 0.5, "recoveries": 0.5}),
    "Stopper centre-back": ("Defenders", {"clearances": 1.2, "aerials_won": 1.0, "interceptions": 0.5, "key_passes": -0.3}),
    "Ball-playing centre-back": ("Defenders", {"final_third_passes": 0.8, "clearances": 0.6, "interceptions": 0.5}),
    "Progressive wing-back": ("Defenders", {"xa": 0.6, "big_chances_created": 0.5, "final_third_passes": 0.6, "key_passes": 0.5, "tackles_won": 0.3}),
    "Defensive full-back": ("Defenders", {"tackles_won": 1.0, "interceptions": 0.8, "clearances": 0.4, "recoveries": 0.4}),
}


def cluster_space(z: np.ndarray, roles: pd.Series) -> np.ndarray:
    onehot = np.column_stack([(roles == r).to_numpy(float) for r in ROLES])
    return np.hstack([z, onehot * ROLE_WEIGHT])


def zscores(df: pd.DataFrame, scaler: StandardScaler) -> np.ndarray:
    return np.clip(scaler.transform(df[P90]), -CLIP, CLIP)


def silhouettes(x: np.ndarray) -> dict[int, float]:
    scores = {}
    for k in K_RANGE:
        km = KMeans(n_clusters=k, n_init=20, random_state=SEED).fit(x)
        scores[k] = round(float(silhouette_score(x, km.labels_, random_state=SEED)), 4)
    return scores


def name_clusters(centroids: np.ndarray, main_role: list[str]) -> list[str]:
    """Give every cluster a different template name, maximising the total
    fit. A template for the wrong role can still win, but it has to fit a
    lot better to do it."""
    names = list(TEMPLATES)
    style = centroids[:, : len(FEATURES)]
    fit = np.zeros((len(centroids), len(names)))
    for j, name in enumerate(names):
        role, weights = TEMPLATES[name]
        w = np.array([weights.get(f, 0.0) for f in FEATURES])
        fit[:, j] = style @ (w / np.linalg.norm(w)) + np.array([0.8 if r == role else 0.0 for r in main_role])
    rows, cols = linear_sum_assignment(-fit)
    out = [""] * len(centroids)
    for r, c in zip(rows, cols):
        out[r] = names[c]
    return out


def top_matches(df: pd.DataFrame, sim: np.ndarray, n: int = TOP_N) -> dict[str, list[dict]]:
    """Default search: same league, same role, 300+ minutes. Keyed by
    "id|league" because someone who switched leagues mid-season is listed
    once in each."""
    out = {}
    for i, row in enumerate(df.itertuples()):
        pool = np.where((df["league"].to_numpy() == row.league) & (df["role"].to_numpy() == row.role))[0]
        pool = pool[pool != i]
        best = pool[np.argsort(-sim[i, pool], kind="stable")[:n]]
        out[f"{row.player_id}|{row.league}"] = [{"id": int(df.iloc[j]["player_id"]), "sim": round(float(sim[i, j]), 4)} for j in best]
    return out


def percentiles(df: pd.DataFrame) -> pd.DataFrame:
    """0-100 rank of each per 90 stat within the player's role, for the radar."""
    pct = df.groupby("role")[P90].rank(pct=True) * 100
    return pct.round(1).add_prefix("pct_")


def run(verbose: bool = True) -> dict:
    MODELS.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)
    now = current_season()
    base_season = now - 1

    base = add_roles(load_players(base_season))
    scaler = StandardScaler().fit(base[P90])
    z = zscores(base, scaler)
    x = cluster_space(z, base["role"])

    scores = silhouettes(x)
    kmeans = KMeans(n_clusters=K, n_init=50, random_state=SEED).fit(x)
    main_role = [base.loc[kmeans.labels_ == c, "role"].value_counts().idxmax() for c in range(K)]
    names = name_clusters(kmeans.cluster_centers_, main_role)
    pca = PCA(n_components=2, random_state=SEED).fit(x)

    joblib.dump({"scaler": scaler, "kmeans": kmeans, "pca": pca, "names": names}, MODELS / "engine.joblib")

    summary = {
        "fitted_on": label(base_season),
        "k": K,
        "role_weight": ROLE_WEIGHT,
        "silhouette": scores,
        "pca_explained": [round(float(v), 4) for v in pca.explained_variance_ratio_],
        "pca_loadings": {f: [round(float(a), 4), round(float(b), 4)] for f, a, b in zip(FEATURES, *pca.components_)},
        "archetypes": [],
        "seasons": {},
    }
    for c, name in enumerate(names):
        members = base[kmeans.labels_ == c]
        centroid = dict(zip(FEATURES, kmeans.cluster_centers_[c][: len(FEATURES)].round(3).tolist()))
        summary["archetypes"].append(
            {
                "id": c,
                "name": name,
                "size": int(len(members)),
                "centroid": centroid,
                "roles": members["role"].value_counts().to_dict(),
                "examples": members.sort_values("minutes", ascending=False)["player"].head(6).tolist(),
            }
        )

    for start in (base_season, now):
        df = base if start == base_season else add_roles(load_players(start))
        zs = zscores(df, scaler)
        xs = cluster_space(zs, df["role"])
        clusters = kmeans.predict(xs)
        coords = pca.transform(xs)
        sim = cosine_similarity(zs)

        assigned = df[["player_id", "player", "team", "league", "position", "role", "minutes"]].copy()
        assigned["cluster"] = clusters
        assigned["archetype"] = [names[c] for c in clusters]
        assigned["pc1"], assigned["pc2"] = coords[:, 0].round(4), coords[:, 1].round(4)
        # how close a player sits to their own centroid, useful for "purest example of"
        dist = np.linalg.norm(xs - kmeans.cluster_centers_[clusters], axis=1)
        assigned["fit"] = (1 / (1 + dist)).round(4)
        assigned = pd.concat([assigned, percentiles(df)], axis=1)
        assigned.to_csv(PROCESSED / f"assigned_{start}.csv", index=False)

        (REPORTS / f"top_matches_{start}.json").write_text(json.dumps(top_matches(df, sim)), encoding="utf-8")
        summary["seasons"][label(start)] = {"players": int(len(df)), "clusters": assigned["archetype"].value_counts().to_dict()}

    (REPORTS / "engine.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")

    if verbose:
        print(f"silhouette by K: {scores}  (using K = {K})")
        print(f"PCA explains {sum(summary['pca_explained']):.0%} of the variance in 2D")
        for a in summary["archetypes"]:
            top = sorted(a["centroid"].items(), key=lambda kv: -kv[1])[:3]
            print(f"  {a['name']:24s} {a['size']:3d}  top: {', '.join(f'{f} {v:+.1f}' for f, v in top)}")
            print(f"  {'':24s}      e.g. {', '.join(a['examples'][:4])}")
    return summary


if __name__ == "__main__":
    run()
