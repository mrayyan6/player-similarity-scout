import { findSimilar } from "./similarity.js";
import { createRadar, createMap, tip, untip } from "./charts.js";
import { clubMark } from "./clubs.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// Big names to start from, for whichever league is picked: full name as
// Sofascore spells it -> what goes on the button. The first one is who the
// page opens on. The last couple are spares for when someone hasn't played
// enough yet this season.
const QUICK = {
  "Premier League": {
    "Erling Haaland": "Haaland",
    "Virgil van Dijk": "Van Dijk",
    "Mohamed Salah": "Salah",
    "Cole Palmer": "Palmer",
    "Bruno Fernandes": "Bruno Fernandes",
    "Declan Rice": "Rice",
    "Florian Wirtz": "Wirtz",
    "Martin Ødegaard": "Ødegaard",
    "Phil Foden": "Foden",
    "Alexander Isak": "Isak",
  },
  "La Liga": {
    "Lamine Yamal": "Yamal",
    "Kylian Mbappé": "Mbappé",
    "Jude Bellingham": "Bellingham",
    "Vinícius Júnior": "Vinícius",
    "Raphinha": "Raphinha",
    "Pedri": "Pedri",
    "Robert Lewandowski": "Lewandowski",
    "Antoine Griezmann": "Griezmann",
    "Federico Valverde": "Valverde",
    "Nico Williams": "Nico Williams",
  },
  cross: {
    "Lamine Yamal": "Yamal",
    "Kylian Mbappé": "Mbappé",
    "Erling Haaland": "Haaland",
    "Virgil van Dijk": "Van Dijk",
    "Jude Bellingham": "Bellingham",
    "Vinícius Júnior": "Vinícius",
    "Raphinha": "Raphinha",
    "Mohamed Salah": "Salah",
    "Cole Palmer": "Palmer",
    "Pedri": "Pedri",
  },
};
const QUICK_SHOWN = 8;

const state = { season: null, league: "Premier League", role: "same", minMinutes: 300, target: null, match: 0 };
let meta;
const seasons = {};
let radar;
let map;
let hidden = new Set(); // archetypes switched off on the map

// data

async function json(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function loadSeason(key) {
  if (!seasons[key]) seasons[key] = await json(`data/players_${key}.json`);
  return seasons[key];
}

const players = () => seasons[state.season];
const inLeague = (p) => state.league === "cross" || p.league === state.league;
const pool = () => players().filter((p) => inLeague(p) && p.min >= state.minMinutes);
const seasonMeta = () => meta.seasons.find((s) => s.key === state.season);

function normalise(text) {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ø/gi, "o").toLowerCase();
}

// percentile of each stat, measured against every player in the target's
// position group this season, so both radar shapes use the same yardstick
function percentilesAgainst(group, player) {
  return player.p90.map((v, i) => {
    let less = 0;
    let equal = 0;
    for (const q of group) {
      if (q.p90[i] < v) less += 1;
      else if (q.p90[i] === v) equal += 1;
    }
    return ((less + (equal + 1) / 2) / group.length) * 100;
  });
}

function matches() {
  const t = state.target;
  if (!t) return [];
  return findSimilar(players(), t, {
    league: state.league === "cross" ? "cross" : state.league,
    role: state.role,
    minMinutes: state.minMinutes,
    n: 5,
  });
}

// the scout's note: the two things that jump off the page, and the weak spot
function scoutNote(p) {
  const group = players().filter((q) => q.role === p.role);
  const pct = percentilesAgainst(group, p);
  const ranked = meta.features.map((f, i) => ({ f, v: pct[i] })).sort((a, b) => b.v - a.v);
  const top = ranked.slice(0, 2).filter((r) => r.v >= 70);
  const worst = ranked.at(-1);
  const role = p.role.toLowerCase();
  const low = (f) => f.label.toLowerCase();
  const pieces = top.map((r) => `top ${Math.max(1, Math.round(100 - r.v))}% of ${role} for ${low(r.f)}`);
  let note = pieces.length ? pieces.join(", ") : `nothing extreme, a bit of everything for a ${role.slice(0, -1)}`;
  if (worst && worst.v < 25) note += `. Not much in the way of ${low(worst.f)}`;
  return `${note.charAt(0).toUpperCase()}${note.slice(1)}.`;
}

// rendering

function renderFilters() {
  const pills = $("#season-pills");
  if (!pills.children.length) {
    for (const s of meta.seasons) {
      const b = el("button", null, s.full ? s.label : `${s.label} so far`);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.value = s.key;
      b.addEventListener("click", () => setSeason(s.key));
      pills.appendChild(b);
    }
  }
  for (const b of pills.children) b.setAttribute("aria-checked", String(b.dataset.value === state.season));
  for (const b of $("#league-pills").children) b.setAttribute("aria-checked", String(b.dataset.value === state.league));
  $("#role-select").value = state.role;

  const slider = $("#minutes");
  slider.max = String(Math.max(300, Math.floor(seasonMeta().maxMinutes / 30) * 30));
  slider.value = String(state.minMinutes);
  $("#minutes-out").textContent = state.minMinutes.toLocaleString("en-GB");
  const n = pool().length;
  $("#pool-note").textContent = `${n} players to compare. ${seasonMeta().full ? "Full season." : "Season still going, so these are based on a few games each."}`;
}

function renderQuick() {
  const wrap = $("#quick");
  wrap.replaceChildren(el("span", null, "Try:"));
  for (const [p, short] of quickPicks()) {
    const b = el("button", null, short);
    b.type = "button";
    b.addEventListener("click", () => pickTarget(p));
    wrap.appendChild(b);
  }
}

function renderTarget() {
  const card = $("#target");
  const p = state.target;
  card.replaceChildren();
  if (!p) {
    card.appendChild(el("p", "small-note", "Nobody here with these filters. Try fewer minutes or another league."));
    return;
  }
  const who = el("h2", "who");
  const mark = el("mark", null, p.name);
  who.appendChild(mark);
  const arche = meta.archetypes[p.c];
  const badge = el("span", "badge");
  const dot = el("i");
  dot.style.background = `var(--c${p.c})`;
  badge.append(dot, arche.name);
  const info = el("p", "meta");
  info.append(clubMark(p.team), `${p.team} · ${p.league} · ${p.pos ?? p.role} · ${p.min.toLocaleString("en-GB")} min in ${p.apps} games`);
  card.append(who, info);

  // the answer first: who they play most like
  const best = matches()[0];
  if (best) {
    const twin = el("p", "twin");
    twin.append("Plays most like ", el("b", null, best.player.name), " ", el("span", "twin-pct", `${Math.max(0, Math.round(best.sim * 100))}% match`));
    card.appendChild(twin);
  }
  card.append(badge, el("p", "scout-note", scoutNote(p)));
}

function renderMatches() {
  const list = $("#matches");
  const found = matches();
  list.replaceChildren();
  if (!found.length) {
    $("#matches-note").textContent = "No one left to compare with. Loosen the filters.";
    renderRadar(null);
    return;
  }
  state.match = Math.min(state.match, found.length - 1);
  found.forEach((m, i) => {
    const li = el("li");
    const b = el("button", "match");
    b.type = "button";
    b.setAttribute("aria-pressed", String(i === state.match));
    const mid = el("span");
    const sub = el("span", "sub");
    sub.append(clubMark(m.player.team), `${m.player.team}, ${m.player.pos ?? m.player.role}`);
    mid.append(el("span", "name", m.player.name), sub);
    const score = el("span", "score");
    const pct = Math.max(0, Math.round(m.sim * 100));
    const meter = el("span", "meter");
    const fill = el("span");
    fill.style.width = `${pct}%`;
    meter.appendChild(fill);
    score.append(el("b", null, `${pct}% match`), meter);
    b.append(mid, score);
    b.addEventListener("click", () => {
      state.match = i;
      renderMatches();
    });
    // hovering previews the shape without committing to it
    b.addEventListener("pointerenter", () => renderRadar(m.player));
    b.addEventListener("pointerleave", () => renderRadar(found[state.match].player));
    li.appendChild(b);
    list.appendChild(li);
  });
  const where = state.league === "cross" ? "both leagues" : state.league;
  const who = state.role === "same" ? state.target.role.toLowerCase() : state.role === "any" ? "any position" : state.role.toLowerCase();
  $("#matches-note").textContent = `Compared with ${who} in ${where}. Same style doesn't always mean the same level. Hover to preview, click to compare.`;
  renderRadar(found[state.match].player);
}

function renderRadar(match) {
  const t = state.target;
  if (!t) return;
  const group = players().filter((q) => q.role === t.role);
  const tp = percentilesAgainst(group, t);
  const mp = match ? percentilesAgainst(group, match) : null;
  const sides = [{ name: t.name, color: "var(--pen)", p90: t.p90, pct: tp }];
  if (match) sides.push({ name: match.name, color: "var(--marker)", p90: match.p90, pct: mp });
  radar.update(tp, mp, { sides, label: match ? `${t.name} against ${match.name}` : t.name, group: t.role.toLowerCase() });

  const legend = $("#radar-legend");
  legend.replaceChildren();
  for (const s of sides) {
    const item = el("span");
    const key = el("i");
    key.style.borderColor = s.color;
    item.append(key, s.name);
    legend.appendChild(item);
  }
  renderCompare(t, match);
}

function renderCompare(t, m) {
  const table = $("#compare");
  table.replaceChildren();
  const head = el("tr");
  head.append(el("th", null, "Per 90 min"), el("th", null, t.name.split(" ").at(-1)), el("th", null, m ? m.name.split(" ").at(-1) : ""));
  const thead = el("thead");
  thead.appendChild(head);
  const body = el("tbody");
  let group = null;
  meta.features.forEach((f, i) => {
    if (f.group !== group) {
      group = f.group;
      const gr = el("tr", "group");
      const td = el("td", null, group);
      td.colSpan = 3;
      gr.appendChild(td);
      body.appendChild(gr);
    }
    const tr = el("tr");
    const name = el("td");
    if (f.note) {
      const span = el("span", "note-mark", f.label);
      span.addEventListener("pointermove", (e) => tip(e, [{ text: f.label }, { text: f.note }]));
      span.addEventListener("pointerleave", untip);
      name.appendChild(span);
    } else {
      name.textContent = f.label;
    }
    const a = el("td", "num", t.p90[i].toFixed(2));
    const b = el("td", "num", m ? m.p90[i].toFixed(2) : "");
    if (m) {
      if (t.p90[i] > m.p90[i]) a.classList.add("ahead", "t");
      else if (m.p90[i] > t.p90[i]) b.classList.add("ahead", "m");
    }
    tr.append(name, a, b);
    body.appendChild(tr);
  });
  table.append(thead, body);
}

function renderMap() {
  const visible = (p) => inLeague(p) && p.min >= state.minMinutes && !hidden.has(p.c);
  map.draw(players(), {
    visible,
    chosen: state.target,
    names: meta.archetypes.map((a) => a.name),
    axes: meta.pca,
  });

  const chips = $("#legend-chips");
  chips.replaceChildren();
  meta.archetypes.forEach((a) => {
    const b = el("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(!hidden.has(a.id)));
    const dot = el("i");
    dot.style.background = `var(--c${a.id})`;
    const count = players().filter((p) => p.c === a.id && inLeague(p) && p.min >= state.minMinutes).length;
    b.append(dot, `${a.name} (${count})`);
    b.addEventListener("click", () => {
      if (hidden.has(a.id)) hidden.delete(a.id);
      else hidden.add(a.id);
      renderMap();
    });
    chips.appendChild(b);
  });
}

function renderArchetypes() {
  const wrap = $("#archetypes");
  wrap.replaceChildren();
  for (const a of meta.archetypes) {
    const card = el("article", "archetype");
    card.style.setProperty("--swatch", `var(--c${a.id})`);
    const members = players().filter((p) => p.c === a.id && inLeague(p));
    card.append(
      el("h3", null, a.name),
      el("span", "count", `${members.length} ${members.length === 1 ? "player" : "players"}`),
      el("p", null, a.about)
    );
    const ex = el("div", "examples");
    ex.appendChild(el("span", "examples-label", "Typical:"));
    // purest examples: closest to the centre of the cluster, with real minutes
    const best = members.filter((p) => p.min >= 900).sort((x, y) => y.fit - x.fit).slice(0, 4);
    for (const p of best) {
      const b = el("button", null, p.name);
      b.type = "button";
      b.title = `${p.team}, closest to the middle of this group`;
      b.addEventListener("click", () => {
        pickTarget(p);
        document.getElementById("tab-twins").click();
      });
      ex.appendChild(b);
    }
    card.appendChild(ex);
    wrap.appendChild(card);
  }
}

// the technical side, for whoever opens the nerd section
function renderNerd() {
  const kept = Math.round((meta.pca.explained[0] + meta.pca.explained[1]) * 100);
  $("#nerd-map").textContent = `PCA squashes the fourteen numbers down to two and keeps ${kept}% of the variation, so neighbours on the map are usually similar, but the twin search is the better judge. Left to right runs from ${meta.pca.x[0]} to ${meta.pca.x[1]}, bottom to top from ${meta.pca.y[0]} to ${meta.pca.y[1]}.`;
  const sil = Object.entries(meta.silhouette).map(([k, v]) => `K=${k}: ${v.toFixed(2)}`).join(", ");
  $("#nerd-k").textContent = `K-Means with K=${meta.k} on the scaled numbers plus the position group as a weighted one-hot, so full-backs don't get lumped in with holding midfielders. Fitted on ${meta.fittedOn} and applied to this season too. Silhouette scores (${sil}) are fairly flat, so ${meta.k} is a judgement call: the extra groups are real roles rather than noise. Each group is named by matching its centre against hand-written templates. What the centres look like:`;
  $("#nerd-styles").replaceChildren(
    ...meta.archetypes.map((a) => {
      const li = el("li");
      li.append(el("b", null, `${a.name}: `), a.stats);
      return li;
    })
  );
}

function renderAll() {
  renderFilters();
  renderQuick();
  renderTarget();
  renderMatches();
  renderMap();
  renderArchetypes();
  renderNerd();
  writeHash();
}

// state changes

function pickTarget(p) {
  state.target = p;
  state.match = 0;
  if (!inLeague(p)) state.league = p.league;
  if (p.min < state.minMinutes) state.minMinutes = 300;
  renderAll();
}

function ensureTarget() {
  const list = players();
  const keep = state.target && list.find((p) => p.id === state.target.id && p.league === state.target.league);
  if (keep && inLeague(keep)) {
    state.target = keep;
    return;
  }
  const [big] = quickPicks()[0] ?? [];
  state.target = big ?? pool().sort((a, b) => b.min - a.min)[0] ?? null;
}

// the big names for the league that are in this season's data, best first
function quickPicks() {
  const list = players();
  return Object.entries(QUICK[state.league])
    .map(([name, short]) => [list.find((p) => p.name === name && inLeague(p)), short])
    .filter(([p]) => p)
    .slice(0, QUICK_SHOWN);
}

async function setSeason(key) {
  state.season = key;
  await loadSeason(key);
  state.minMinutes = Math.min(state.minMinutes, Math.max(300, seasonMeta().maxMinutes));
  ensureTarget();
  renderAll();
}

function writeHash() {
  const leagueKey = { "Premier League": "epl", "La Liga": "laliga", cross: "both" }[state.league];
  const id = state.target ? state.target.id : "";
  try {
    history.replaceState(null, "", `#${state.season}/${leagueKey}/${id}`);
  } catch (e) {
    // sandboxed preview, not important
  }
}

// search

function wireSearch() {
  const input = $("#search-input");
  const list = $("#search-list");
  let hits = [];
  let active = -1;
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  };
  const pick = (p) => {
    close();
    input.value = "";
    pickTarget(p);
  };
  const paint = () => {
    list.replaceChildren();
    if (!hits.length) list.appendChild(el("li", "empty", "Nobody with that name and 300+ minutes"));
    hits.forEach((p, i) => {
      const li = el("li");
      li.id = `hit-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === active));
      const sub = el("span", "sub");
      sub.append(clubMark(p.team), `${p.team} · ${p.pos ?? p.role}`);
      li.append(el("span", null, p.name), sub);
      li.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        pick(p);
      });
      list.appendChild(li);
    });
    if (active >= 0) input.setAttribute("aria-activedescendant", `hit-${active}`);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  input.addEventListener("input", () => {
    const q = normalise(input.value.trim());
    if (!q) return close();
    // search both leagues, picking someone from the other one switches league
    hits = players()
      .filter((p) => normalise(p.name).includes(q) || normalise(p.team).includes(q))
      .sort((a, b) => b.min - a.min)
      .slice(0, 9);
    active = hits.length ? 0 : -1;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden || !hits.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === "Escape") {
      close();
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 100));
}

function wire() {
  for (const b of $("#league-pills").children) {
    b.addEventListener("click", () => {
      state.league = b.dataset.value;
      ensureTarget();
      renderAll();
    });
  }
  $("#role-select").addEventListener("change", (e) => {
    state.role = e.target.value;
    state.match = 0;
    renderAll();
  });
  let t;
  $("#minutes").addEventListener("input", (e) => {
    state.minMinutes = Number(e.target.value);
    $("#minutes-out").textContent = state.minMinutes.toLocaleString("en-GB");
    clearTimeout(t);
    t = setTimeout(() => {
      if (state.target && state.target.min < state.minMinutes) ensureTarget();
      state.match = 0;
      renderAll();
    }, 60);
  });
  $("#zoom-in").addEventListener("click", () => map.zoom(1.4));
  $("#zoom-out").addEventListener("click", () => map.zoom(1 / 1.4));
  $("#zoom-reset").addEventListener("click", () => map.reset());

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const show = (tab) => {
    for (const x of tabs) {
      const on = x === tab;
      x.setAttribute("aria-selected", String(on));
      x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute("aria-controls")).hidden = !on;
    }
    untip();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => show(tab));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      show(next);
      next.focus();
    });
  });

  $("#theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try {
      localStorage.setItem("theme", root.dataset.theme);
    } catch (e) {
      // private window, fine for this visit
    }
  });
}

async function init() {
  meta = await json("data/meta.json");
  radar = createRadar($("#radar"), meta.features);
  map = createMap($("#map"), {
    onPick: (p) => {
      pickTarget(p);
      document.getElementById("tab-twins").click();
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });
  wire();
  wireSearch();

  const [season, leagueKey, id] = location.hash.slice(1).split("/");
  state.league = { epl: "Premier League", laliga: "La Liga", both: "cross" }[leagueKey] ?? "Premier League";
  const key = meta.seasons.some((s) => s.key === season) ? season : meta.seasons[0].key;
  state.season = key;
  await loadSeason(key);
  const fromHash = players().find((p) => String(p.id) === id && inLeague(p));
  if (fromHash) state.target = fromHash;
  ensureTarget();
  $("#foot-note").textContent = `Last updated ${new Date(`${meta.exported}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`;
  renderAll();
}

init().catch((err) => {
  console.error(err);
  $("#target").textContent = "Couldn't load the data. Try a refresh.";
});
