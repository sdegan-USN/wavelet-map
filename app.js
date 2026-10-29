// Wavelet Map: draws FNMOC NOSSP wavelet areas as boxes on an equirectangular map.
// No external resources; data/areas.json and data/land.geojson are served alongside.
(function () {
  const svg = document.getElementById('map');
  const view = document.getElementById('view');
  const boxesG = document.getElementById('boxes');
  const gratG = document.getElementById('grat');
  const landP = document.getElementById('land');
  const tip = document.getElementById('tip');
  const list = document.getElementById('list');
  const panelTitle = document.getElementById('panel-title');
  const panelSub = document.getElementById('panel-sub');
  const search = document.getElementById('search');
  const fleetsEl = document.getElementById('fleets');
  const NS = 'http://www.w3.org/2000/svg';

  let areas = [], fleetFilter = null, query = '', selected = null;
  // viewBox state in map units (lon, -lat)
  let vb = { x: -180, y: -90, w: 360, h: 180 };
  const FULL = { x: -180, y: -90, w: 360, h: 180 };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- projection ----------
  function applyVB() {
    const r = svg.getBoundingClientRect();
    const asp = r.width / r.height;
    let w = vb.w, hh = vb.h;
    if (w / hh > asp) hh = w / asp; else w = hh * asp;
    svg.setAttribute('viewBox', `${vb.x + (vb.w - w) / 2} ${vb.y + (vb.h - hh) / 2} ${w} ${hh}`);
  }
  function toMap(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const m = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { lon: m.x, lat: -m.y };
  }
  function fit(b, pad) {
    pad = pad == null ? 0.25 : pad;
    let w = b.east - b.west; if (w <= 0) w += 360;
    const hh = b.north - b.south;
    const px = Math.max(w * pad, 1), py = Math.max(hh * pad, 1);
    let cx = b.west + w / 2; if (cx > 180) cx -= 360;
    vb = { x: cx - w / 2 - px, y: -b.north - py, w: w + 2 * px, h: hh + 2 * py };
    applyVB();
  }
  function zoomAt(f, lon, lat) {
    const nw = Math.min(360, Math.max(0.3, vb.w * f)), nh = vb.h * (nw / vb.w);
    const cx = lon == null ? vb.x + vb.w / 2 : lon, cy = lat == null ? vb.y + vb.h / 2 : -lat;
    vb = { x: cx - (cx - vb.x) * (nw / vb.w), y: cy - (cy - vb.y) * (nh / vb.h), w: nw, h: nh };
    applyVB();
  }

  // ---------- land ----------
  function ringPath(ring) {
    let d = '';
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      d += (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + (-p[1]).toFixed(2);
    }
    return d + 'Z';
  }
  function drawLand(gj) {
    let d = '';
    for (const f of gj.features) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      for (const poly of polys) for (const ring of poly) d += ringPath(ring);
    }
    landP.setAttribute('d', d);
  }
  function drawGrat() {
    for (let lon = -180; lon <= 180; lon += 30) {
      el('line', { x1: lon, y1: -90, x2: lon, y2: 90 }, gratG);
      if (lon > -180 && lon < 180) el('text', { x: lon + 0.5, y: 89, 'font-size': 2.2 }, gratG).textContent = lon < 0 ? (-lon) + 'W' : lon ? lon + 'E' : '0';
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      el('line', { x1: -180, y1: -lat, x2: 180, y2: -lat }, gratG);
      el('text', { x: -179, y: -lat - 0.5, 'font-size': 2.2 }, gratG).textContent = lat < 0 ? (-lat) + 'S' : lat ? lat + 'N' : 'EQ';
    }
  }

  // ---------- boxes ----------
  function spans(a) {
    // returns list of [west,east] segments in -180..180
    if (a.east >= a.west) return [[a.west, a.east]];
    return [[a.west, 180], [-180, a.east]];
  }
  function areaDeg(a) {
    let w = a.east - a.west; if (w < 0) w += 360;
    return w * (a.north - a.south);
  }
  function contains(a, lon, lat) {
    if (lat < a.south || lat > a.north) return false;
    return spans(a).some(s => lon >= s[0] && lon <= s[1]);
  }
  function drawBoxes() {
    boxesG.innerHTML = '';
    for (const a of areas) {
      a.rects = [];
      for (const s of spans(a)) {
        const r = el('rect', { x: s[0], y: -a.north, width: s[1] - s[0], height: a.north - a.south, class: 'box ' + a.model }, boxesG);
        r.dataset.id = a.id;
        a.rects.push(r);
      }
    }
  }
  function visible(a) {
    if (fleetFilter && !a.fleets.includes(fleetFilter)) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!(a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))) return false;
    }
    return true;
  }
  function refreshDim() {
    for (const a of areas) for (const r of a.rects) r.classList.toggle('dim', !visible(a));
  }
  function setHover(ids) {
    for (const a of areas) {
      const on = ids.includes(a.id);
      for (const r of a.rects) r.classList.toggle('hover', on);
      if (a.item) a.item.classList.toggle('hover', on);
    }
  }
  function setSelected(id) {
    selected = id;
    for (const a of areas) for (const r of a.rects) r.classList.toggle('sel', a.id === id);
  }

  // ---------- panel ----------
  function fmt(v, pos, neg) { return Math.abs(v).toFixed(2) + ' ' + (v < 0 ? neg : pos); }
  function item(a, open) {
    const d = h('details', 'item');
    if (open) d.open = true;
    const s = h('summary');
    s.appendChild(h('span', 'nm', a.name));
    s.appendChild(h('span', 'id', a.id));
    s.appendChild(h('span', 'ft', a.fleets.join(' · ') + ' · ' + (a.model === 'G' ? 'global' : 'regional') + ' · ' + a.resolution_nm + ' nm'));
    d.appendChild(s);
    const body = h('div', 'body');
    const kv = h('dl', 'kv');
    const rows = [
      ['Latitude', a.lat_text], ['Longitude', a.lon_text],
      ['Resolution', a.resolution_nm + ' nm (lat/lon)'],
      ['Model type', a.model === 'G' ? 'G (global)' : 'R (regional)'],
      ['Size', a.size_kb + ' KB'], ['Date', a.date]];
    for (const [k, v] of rows) { kv.appendChild(h('dt', null, k)); kv.appendChild(h('dd', null, v)); }
    body.appendChild(kv);
    body.appendChild(h('p', 'hours-label', 'Forecast hours (download from FNMOC, CAC):'));
    const hs = h('div', 'hours');
    for (const t of a.hours) {
      const l = h('a', null, String(t.tau));
      l.href = t.url; l.target = '_blank'; l.rel = 'noopener';
      l.title = t.url.split('/').pop();
      hs.appendChild(l);
    }
    body.appendChild(hs);
    const z = h('a', 'zoomto', 'Zoom to this area');
    z.href = '#'; z.addEventListener('click', e => { e.preventDefault(); fit(a); setSelected(a.id); });
    body.appendChild(z);
    d.appendChild(body);
    d.addEventListener('mouseenter', () => setHover([a.id]));
    d.addEventListener('mouseleave', () => setHover([]));
    d.addEventListener('toggle', () => { if (d.open) setSelected(a.id); });
    a.item = d;
    return d;
  }
  function showAll() {
    list.innerHTML = '';
    const vis = areas.filter(visible).sort((x, y) => x.name.localeCompare(y.name));
    panelTitle.textContent = fleetFilter ? fleetFilter : 'All areas';
    panelSub.textContent = vis.length + ' of ' + areas.length;
    if (!vis.length) list.appendChild(h('div', 'empty', 'No area matches.'));
    for (const a of vis) list.appendChild(item(a, false));
  }
  function showAt(lon, lat) {
    const hits = areas.filter(a => visible(a) && contains(a, lon, lat)).sort((x, y) => areaDeg(x) - areaDeg(y));
    list.innerHTML = '';
    panelTitle.textContent = 'At ' + fmt(lat, 'N', 'S') + ', ' + fmt(lon, 'E', 'W');
    panelSub.textContent = hits.length + ' area' + (hits.length === 1 ? '' : 's');
    if (!hits.length) {
      list.appendChild(h('div', 'empty', 'No wavelet area covers this point. Click elsewhere or clear the filter.'));
    }
    hits.forEach((a, i) => list.appendChild(item(a, i === 0)));
    const back = h('a', 'zoomto', 'Show all areas');
    back.href = '#'; back.style.margin = '12px 16px';
    back.addEventListener('click', e => { e.preventDefault(); setSelected(null); showAll(); });
    list.appendChild(back);
    if (hits.length) setSelected(hits[0].id);
  }

  // ---------- interaction ----------
  let drag = null, moved = false;
  svg.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, vb: { ...vb } }; moved = false;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (drag) {
      const r = svg.getBoundingClientRect();
      const vbw = parseFloat(svg.getAttribute('viewBox').split(' ')[2]);
      const scale = vbw / r.width;
      const dx = (e.clientX - drag.x) * scale, dy = (e.clientY - drag.y) * scale;
      if (Math.abs(dx) + Math.abs(dy) > 0.01) moved = true;
      vb = { ...drag.vb, x: drag.vb.x - dx, y: drag.vb.y - dy };
      applyVB();
      return;
    }
    const p = toMap(e.clientX, e.clientY);
    const hits = areas.filter(a => visible(a) && contains(a, p.lon, p.lat)).sort((x, y) => areaDeg(x) - areaDeg(y));
    if (hits.length) {
      const a = hits[0];
      setHover([a.id]);
      tip.hidden = false;
      tip.innerHTML = '';
      tip.appendChild(document.createTextNode(a.name + ' (' + a.id + ')'));
      const sm = h('small', null, hits.length > 1 ? '+' + (hits.length - 1) + ' more here · click to list' : a.lat_text + ' · ' + a.lon_text);
      tip.appendChild(sm);
      const wr = svg.parentElement.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - wr.left + 14, wr.width - 330) + 'px';
      tip.style.top = (e.clientY - wr.top + 14) + 'px';
    } else { setHover([]); tip.hidden = true; }
  });
  svg.addEventListener('pointerup', e => {
    if (drag && !moved) { const p = toMap(e.clientX, e.clientY); showAt(p.lon, p.lat); }
    drag = null;
  });
  svg.addEventListener('pointerleave', () => { setHover([]); tip.hidden = true; });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const p = toMap(e.clientX, e.clientY);
    zoomAt(e.deltaY > 0 ? 1.25 : 0.8, p.lon, p.lat);
  }, { passive: false });
  document.getElementById('zin').addEventListener('click', () => zoomAt(0.7));
  document.getElementById('zout').addEventListener('click', () => zoomAt(1.4));
  document.getElementById('zfit').addEventListener('click', () => { vb = { ...FULL }; applyVB(); });
  window.addEventListener('resize', applyVB);

  search.addEventListener('input', () => { query = search.value.trim(); refreshDim(); showAll(); });
  document.getElementById('about-btn').addEventListener('click', () => document.getElementById('about').showModal());

  function buildFleets() {
    const fl = [...new Set(areas.flatMap(a => a.fleets))].sort();
    const mk = (label, val) => {
      const b = h('button', 'chip', label); b.type = 'button';
      b.addEventListener('click', () => {
        fleetFilter = val; [...fleetsEl.children].forEach(c => c.classList.toggle('on', c === b));
        refreshDim(); showAll();
      });
      return b;
    };
    const all = mk('All', null); all.classList.add('on'); fleetsEl.appendChild(all);
    for (const f of fl) fleetsEl.appendChild(mk(f.replace(' Fleet', ''), f));
  }

  // ---------- load ----------
  Promise.all([fetch('data/areas.json').then(r => r.json()), fetch('data/land.geojson').then(r => r.json())])
    .then(([d, land]) => {
      areas = d.areas;
      document.getElementById('updated').textContent = 'FNMOC list snapshot: ' + d.updated + ' · ' + areas.length + ' areas';
      drawLand(land); drawGrat(); drawBoxes(); buildFleets(); showAll();
      applyVB();
    })
    .catch(err => { list.appendChild(h('div', 'empty', 'Could not load the area list: ' + err)); });
})();
