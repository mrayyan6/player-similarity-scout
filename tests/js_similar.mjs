// Called from test_export.py: top matches for every player with the
// default filters (same league, same role), as JSON.
import { readFileSync } from "node:fs";
import { findSimilar } from "../web/js/similarity.js";

const players = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = {};
for (const p of players) {
  out[`${p.id}|${p.league}`] = findSimilar(players, p, { n: 10 }).map((m) => ({ id: m.player.id, sim: m.sim }));
}
console.log(JSON.stringify(out));
