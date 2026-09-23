// Cosine similarity on the exported z-scores. Same maths as
// similarity_engine.py, just run on whatever pool the filters leave.

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// league: "same" (target's league), "cross" (both), or a league name
// role: "same", "any", or a role name
export function findSimilar(players, target, { league = "same", role = "same", minMinutes = 300, n = 5 } = {}) {
  const wantLeague = league === "same" ? target.league : league;
  const wantRole = role === "same" ? target.role : role;
  const out = [];
  for (const p of players) {
    if (p === target || (p.id === target.id && p.league === target.league)) continue;
    if (league !== "cross" && p.league !== wantLeague) continue;
    if (role !== "any" && p.role !== wantRole) continue;
    if (p.min < minMinutes) continue;
    out.push({ player: p, sim: cosine(target.z, p.z) });
  }
  out.sort((a, b) => b.sim - a.sim);
  return out.slice(0, n);
}
