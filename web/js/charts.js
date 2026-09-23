// Radar and style map, both hand-drawn SVG.

const NS = "http://www.w3.org/2000/svg";
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function s(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

// tooltip, filled with text nodes only (names come from an API)
export function tip(event, rows) {
  const t = document.getElementById("tooltip");
  t.replaceChildren();
  rows.forEach((r, i) => {
    const line = document.createElement(i === 0 ? "b" : "div");
    if (r.swatch) {
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = r.swatch;
      line.appendChild(sw);
    }
    line.append(r.text ?? r);
    t.appendChild(line);
  });
  t.hidden = false;
  const box = t.getBoundingClientRect();
  let x = event.clientX + 14;
  let y = event.clientY + 14;
  if (x + box.width > innerWidth - 8) x = event.clientX - box.width - 14;
  if (y + box.height > innerHeight - 8) y = event.clientY - box.height - 14;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}

export function untip() {
  document.getElementById("tooltip").hidden = true;
}

// Radar: one spoke per stat, 0 to 100 percentile. Shapes morph between
// players instead of being redrawn.

export function createRadar(container, features) {
  const W = 520;
  const H = 470;
  const cx = W / 2;
  const cy = H / 2 + 4;
  const R = 158;
  const n = features.length;
  const angle = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const point = (i, v) => [cx + Math.cos(angle(i)) * (R * v) / 100, cy + Math.sin(angle(i)) * (R * v) / 100];

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, container);
  for (const level of [25, 50, 75, 100]) {
    const pts = features.map((_, i) => point(i, level).join(",")).join(" ");
    s("polygon", { class: "ring", points: pts }, svg);
    const [lx, ly] = point(0, level);
    const t = s("text", { class: "ring-label", x: lx + 4, y: ly - 2 }, svg);
    t.textContent = level;
  }
  features.forEach((f, i) => {
    const [x, y] = point(i, 100);
    s("line", { class: "spoke", x1: cx, y1: cy, x2: x, y2: y }, svg);
    const [lx, ly] = point(i, 118);
    const cos = Math.cos(angle(i));
    const t = s("text", {
      class: "axis-label",
      x: lx,
      y: ly + 4,
      "text-anchor": Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end",
    }, svg);
    t.textContent = f.short;
  });

  const matchShape = s("polygon", { class: "shape match" }, svg);
  const targetShape = s("polygon", { class: "shape target" }, svg);
  const dots = s("g", {}, svg);
  const hits = s("g", {}, svg);

  let current = { t: Array(n).fill(0), m: null };
  let info = null;
  let frame = 0;

  // one invisible wedge per stat carries the hover readout for both players
  features.forEach((f, i) => {
    const a0 = angle(i - 0.5);
    const a1 = angle(i + 0.5);
    const r = R * 1.25;
    const d = `M${cx},${cy}L${cx + Math.cos(a0) * r},${cy + Math.sin(a0) * r}A${r},${r} 0 0 1 ${cx + Math.cos(a1) * r},${cy + Math.sin(a1) * r}Z`;
    const wedge = s("path", { d, fill: "transparent" }, hits);
    wedge.addEventListener("pointermove", (e) => {
      if (!info) return;
      const rows = [{ text: f.label }];
      for (const side of info.sides) {
        rows.push({ swatch: side.color, text: `${side.name}: ${side.p90[i].toFixed(2)} per 90, ${Math.round(side.pct[i])}th percentile` });
      }
      if (f.note) rows.push({ text: f.note });
      tip(e, rows);
    });
    wedge.addEventListener("pointerleave", untip);
  });

  function paint(t, m) {
    targetShape.setAttribute("points", t.map((v, i) => point(i, v).join(",")).join(" "));
    matchShape.setAttribute("points", m ? m.map((v, i) => point(i, v).join(",")).join(" ") : "");
    dots.replaceChildren();
    for (const [vals, color] of [[m, "var(--marker)"], [t, "var(--pen)"]]) {
      if (!vals) continue;
      vals.forEach((v, i) => {
        const [x, y] = point(i, v);
        s("circle", { class: "dot", cx: x, cy: y, r: 3.6, fill: color }, dots);
      });
    }
  }

  function update(target, match, meta) {
    info = meta;
    svg.setAttribute("aria-label", meta.label);
    const from = current;
    const to = { t: target, m: match };
    cancelAnimationFrame(frame);
    if (reduceMotion) {
      current = to;
      paint(to.t, to.m);
      return;
    }
    const start = performance.now();
    const fromM = from.m ?? Array(n).fill(0);
    const step = (now) => {
      const k = Math.min(1, (now - start) / 420);
      const e = 1 - (1 - k) ** 3;
      const t = to.t.map((v, i) => from.t[i] + (v - from.t[i]) * e);
      const m = to.m ? to.m.map((v, i) => fromM[i] + (v - fromM[i]) * e) : null;
      paint(t, m);
      if (k < 1) frame = requestAnimationFrame(step);
      else current = to;
    };
    frame = requestAnimationFrame(step);
  }

  return { update };
}

// Push overlapping labels apart vertically. Widths are guessed from the
// character count, close enough for 12px text and far cheaper than measuring.
function separate(labels) {
  const box = (l) => {
    const w = l.text.length * 7;
    const left = l.anchor === "middle" ? l.x - w / 2 : l.x;
    return { left, right: left + w, top: l.y - 12, bottom: l.y + 3 };
  };
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = box(labels[i]);
        const b = box(labels[j]);
        if (a.left > b.right || b.left > a.right || a.top > b.bottom || b.top > a.bottom) continue;
        const push = (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) / 2 + 1;
        const [up, down] = labels[i].y <= labels[j].y ? [labels[i], labels[j]] : [labels[j], labels[i]];
        if (!up.fixed) up.y -= push;
        if (!down.fixed) down.y += push;
        if (up.fixed && down.fixed) continue;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

// Style map: PCA scatter with zoom and pan. Dots keep their size on screen
// while zooming, labels stay readable.

export function createMap(container, { onPick }) {
  const svg = s("svg", { role: "img", "aria-label": "Map of playing styles" }, container);
  const plot = s("g", {}, svg);
  const overlay = s("g", {}, svg);
  let W = 0;
  let H = 0;
  let view = { k: 1, x: 0, y: 0 };
  let items = [];
  let players = [];
  let opts = null;
  let scaleX;
  let scaleY;

  function size() {
    W = container.clientWidth;
    H = Math.round(Math.min(620, Math.max(380, W * 0.66)));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.height = `${H}px`;
  }

  function draw(list, options) {
    players = list;
    opts = options;
    // hidden tab: nothing to measure yet, the ResizeObserver draws once shown
    if (!container.clientWidth) return;
    size();
    const xs = players.map((p) => p.xy[0]);
    const ys = players.map((p) => p.xy[1]);
    const pad = 36;
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    scaleX = (v) => pad + ((v - x0) / (x1 - x0)) * (W - pad * 2);
    scaleY = (v) => H - pad - ((v - y0) / (y1 - y0)) * (H - pad * 2);

    plot.replaceChildren();
    items = players.map((p) => {
      const c = s("circle", { class: "pt", cx: scaleX(p.xy[0]), cy: scaleY(p.xy[1]), fill: `var(--c${p.c})` }, plot);
      return { p, c, x: scaleX(p.xy[0]), y: scaleY(p.xy[1]) };
    });
    restyle();
  }

  function restyle() {
    if (!opts) return;
    for (const it of items) {
      const on = opts.visible(it.p);
      it.on = on;
      it.c.classList.toggle("dim", !on);
      it.c.classList.toggle("chosen", it.p === opts.chosen);
    }
    const chosen = items.find((it) => it.p === opts.chosen);
    if (chosen) plot.appendChild(chosen.c);
    applyView();
  }

  function applyView() {
    plot.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
    for (const it of items) it.c.setAttribute("r", (it.p === opts?.chosen ? 7 : 4.2) / view.k);
    for (const it of items) it.c.setAttribute("stroke-width", 1.2 / view.k);

    // labels live outside the scaled group so the text stays the same size
    overlay.replaceChildren();
    const toScreen = (x, y) => [x * view.k + view.x, y * view.k + view.y];
    const groups = new Map();
    for (const it of items) {
      if (!it.on) continue;
      const g = groups.get(it.p.c) ?? { x: 0, y: 0, n: 0 };
      g.x += it.x;
      g.y += it.y;
      g.n += 1;
      groups.set(it.p.c, g);
    }
    const labels = [];
    for (const [c, g] of groups) {
      if (g.n < 4) continue;
      const [x, y] = toScreen(g.x / g.n, g.y / g.n);
      labels.push({ x, y, text: opts.names[c], cls: "cluster-label", anchor: "middle" });
    }
    const chosen = items.find((it) => it.p === opts?.chosen);
    if (chosen) {
      const [x, y] = toScreen(chosen.x, chosen.y);
      labels.push({ x: x + 10, y: y - 10, text: chosen.p.name, cls: "chosen-label", anchor: "start", fixed: true });
    }
    separate(labels);
    for (const l of labels) {
      const t = s("text", { class: l.cls, x: l.x, y: l.y, "text-anchor": l.anchor }, overlay);
      t.textContent = l.text;
    }
    if (opts?.axes) {
      const [xl, xr] = opts.axes.x;
      const [yb, yt] = opts.axes.y;
      const a = s("text", { class: "axis-end", x: 12, y: H - 10 }, overlay);
      a.textContent = `← ${xl}`;
      const b = s("text", { class: "axis-end", x: W - 12, y: H - 10, "text-anchor": "end" }, overlay);
      b.textContent = `${xr} →`;
      const c = s("text", { class: "axis-end", x: 12, y: 24 }, overlay);
      c.textContent = `↑ ${yt}`;
      const d = s("text", { class: "axis-end", x: 12, y: H - 34 }, overlay);
      d.textContent = `↓ ${yb}`;
    }
  }

  function zoomAt(factor, sx, sy) {
    const k = Math.min(12, Math.max(1, view.k * factor));
    const f = k / view.k;
    view = { k, x: sx - (sx - view.x) * f, y: sy - (sy - view.y) * f };
    clamp();
    applyView();
  }

  function clamp() {
    view.x = Math.min(0, Math.max(W - W * view.k, view.x));
    view.y = Math.min(0, Math.max(H - H * view.k, view.y));
  }

  function local(evt) {
    const r = svg.getBoundingClientRect();
    return [((evt.clientX - r.left) / r.width) * W, ((evt.clientY - r.top) / r.height) * H];
  }

  function nearest(evt) {
    const [sx, sy] = local(evt);
    const x = (sx - view.x) / view.k;
    const y = (sy - view.y) / view.k;
    let best = null;
    let bestD = (14 / view.k) ** 2;
    for (const it of items) {
      if (!it.on) continue;
      const d = (it.x - x) ** 2 + (it.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  let hot = null;
  const pointers = new Map();
  let drag = null;
  let pinch = null;

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [sx, sy] = local(e);
    zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, sx, sy);
  }, { passive: false });

  svg.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, local(e));
    svg.setPointerCapture(e.pointerId);
    if (pointers.size === 1) drag = { start: local(e), view: { ...view }, moved: false };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k };
      drag = null;
    }
  });

  svg.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, local(e));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((pinch.k * (d / pinch.d)) / view.k, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      return;
    }
    if (drag) {
      const [sx, sy] = local(e);
      const dx = sx - drag.start[0];
      const dy = sy - drag.start[1];
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        svg.classList.add("dragging");
        view = { ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy };
        clamp();
        applyView();
        untip();
        return;
      }
    }
    const it = nearest(e);
    if (hot && hot !== it) hot.c.classList.remove("hot");
    hot = it;
    if (it) {
      it.c.classList.add("hot");
      const p = it.p;
      tip(e, [
        { text: p.name },
        { text: `${p.team}, ${p.league}` },
        { text: `${p.pos ?? p.role}, ${p.min.toLocaleString("en-GB")} minutes` },
        { swatch: `var(--c${p.c})`, text: opts.names[p.c] },
      ]);
    } else {
      untip();
    }
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && e.type === "pointerup") {
      const it = nearest(e);
      if (it) onPick(it.p);
    }
    if (pointers.size === 0) drag = null;
    svg.classList.remove("dragging");
  };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);
  svg.addEventListener("pointerleave", () => {
    if (hot) hot.c.classList.remove("hot");
    hot = null;
    untip();
  });

  new ResizeObserver(() => {
    if (opts && container.clientWidth && container.clientWidth !== W) {
      view = { k: 1, x: 0, y: 0 };
      draw(players, opts);
    }
  }).observe(container);

  return {
    draw,
    restyle: (o) => {
      opts = { ...opts, ...o };
      restyle();
    },
    zoom: (f) => zoomAt(f, W / 2, H / 2),
    reset: () => {
      view = { k: 1, x: 0, y: 0 };
      applyView();
    },
  };
}
