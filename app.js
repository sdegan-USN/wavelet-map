// Wavelet Map: draws FNMOC NOSSP wavelet areas as boxes on an equirectangular map.
// No external resources; data/areas.json and data/land.geojson are served alongside.
(function () {
  const svg = document.getElementById('map');
  const view = document.getElementById('view');
  const boxesG = document.getElementById('boxes');
  const gratG = document.getElementById('grat');
  const landP = document.getElementById('land');
  const tip = document.getElementById('tip');
  const cur = document.getElementById('cursor');
  const list = document.getElementById('list');
  const panelTitle = document.getElementById('panel-title');
  const panelSub = document.getElementById('panel-sub');
  const search = document.getElementById('search');
  const fleetsEl = document.getElementById('fleets');
  const NS = 'http://www.w3.org/2000/svg';

  let areas = [], fleetFilter = null, query = '', selected = null;
  // viewBox state in map units (lon, -lat)
  const HOME_LON = -60; // centre of the opening view
  let vb = { x: HOME_LON - 180, y: -90, w: 360, h: 180 };
  function homeView() { vb = { x: HOME_LON - 0.5, y: -90, w: 1, h: 180 }; applyVB(); }

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
    // The rectangle actually shown is the viewBox widened or heightened to the screen's
    // aspect. Height is pinned to the world (90N..90S fills the screen when zoomed out);
    // width wraps: the world is drawn three times side by side, so x is kept within
    // one world of the centre copy.
    const r = svg.getBoundingClientRect();
    const asp = r.width / r.height || 2;
    let w = vb.w, hh = vb.h;
    if (w / hh > asp) hh = w / asp; else w = hh * asp;
    if (hh > 180) { w *= 180 / hh; hh = 180; }
    if (w > 360) { hh *= 360 / w; w = 360; }
    let x = vb.x + (vb.w - w) / 2, y = vb.y + (vb.h - hh) / 2;
    y = hh >= 180 ? -90 : Math.max(-90, Math.min(90 - hh, y));
    const cx = x + w / 2;
    if (cx < -180) x += 360; else if (cx > 180) x -= 360;
    vb = { x, y, w, h: hh };
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${hh}`);
  }
  function toMap(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const m = pt.matrixTransform(svg.getScreenCTM().inverse());
    let lon = m.x; while (lon < -180) lon += 360; while (lon >= 180) lon -= 360;
    return { lon, lat: -m.y, rawLon: m.x };
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
    const nw = Math.max(0.3, vb.w * f), nh = vb.h * (nw / vb.w);
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
    for (const off of [-360, 360]) el('use', { href: '#world', transform: `translate(${off} 0)` }, document.getElementById('copies'));
  }
  function drawGrat() {
    for (let lon = -180; lon <= 180; lon += 30) {
      el('line', { x1: lon, y1: -90, x2: lon, y2: 90 }, gratG);
      if (lon > -180 && lon < 180) el('text', { x: lon + 0.5, y: 89, 'font-size': 1.7 }, gratG).textContent = lon < 0 ? (-lon) + 'W' : lon ? lon + 'E' : '0';
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      el('line', { x1: -180, y1: -lat, x2: 180, y2: -lat }, gratG);
      el('text', { x: -179, y: -lat - 0.5, 'font-size': 1.7 }, gratG).textContent = lat < 0 ? (-lat) + 'S' : lat ? lat + 'N' : 'EQ';
    }
  }

  // ---------- fleet areas (approximate) ----------
  function drawFleets(fl) {
    const g = document.getElementById('fleets-g');
    g.innerHTML = '';
    for (const off of [-360, 0, 360]) {
      for (const f of fl.fleets) {
        const d = f.polygon.map((p, i) => (i ? 'L' : 'M') + (p[0] + off) + ' ' + (-p[1])).join('') + 'Z';
        el('path', { d, class: 'fleet' }, g);
        const t = el('text', { x: f.label[0] + off, y: -f.label[1], class: 'fleet-label', 'font-size': 4 }, g);
        t.textContent = f.id;
      }
    }
  }
  function fitFleet(name) {
    const sel = areas.filter(a => a.fleets.includes(name));
    if (!sel.length) return;
    // bounding box in two framings (west-east, and shifted by 360 for the Pacific), keep the narrower
    const best = [0, 360].map(sh => {
      let w = Infinity, e = -Infinity, so = Infinity, no = -Infinity;
      for (const a of sel) {
        let x0 = a.west, x1 = a.west + widthDeg(a);
        if (sh && x0 < 0) { x0 += 360; x1 += 360; }
        w = Math.min(w, x0); e = Math.max(e, x1); so = Math.min(so, a.south); no = Math.max(no, a.north);
      }
      return { west: w, east: e, south: so, north: no, span: e - w };
    }).sort((p, q) => p.span - q.span)[0];
    let cx = (best.west + best.east) / 2; if (cx > 180) cx -= 360;
    const w = best.span, hh = best.north - best.south;
    vb = { x: cx - w / 2 - w * 0.08, y: -best.north - hh * 0.08, w: w * 1.16, h: hh * 1.16 };
    applyVB(); closePop();
  }

  // ---------- boxes ----------
  function widthDeg(a) { let w = a.east - a.west; if (w < 0) w += 360; return w; }
  function areaDeg(a) { return widthDeg(a) * (a.north - a.south); }
  function contains(a, lon, lat) {
    if (lat < a.south || lat > a.north) return false;
    let d = lon - a.west; while (d < 0) d += 360; while (d >= 360) d -= 360;
    return d <= widthDeg(a);
  }
  function drawBoxes() {
    boxesG.innerHTML = '';
    for (const a of areas) {
      a.rects = [];
      for (const off of [-360, 0, 360]) {
        const r = el('rect', { x: a.west + off, y: -a.north, width: widthDeg(a), height: a.north - a.south, class: 'box ' + a.model }, boxesG);
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
    s.appendChild(h('em', 'id', a.id));
    const meta = h('span', 'ft');
    meta.appendChild(h('span', 'tag ' + a.model, a.model === 'G' ? 'Global' : 'Regional'));
    meta.appendChild(h('span', null, a.resolution_nm + ' nm'));
    meta.appendChild(h('span', null, a.fleets.map(f => f.replace(' Fleet', '')).join(', ') + ' Fleet'));
    s.appendChild(meta);
    d.appendChild(s);
    const body = h('div', 'body');
    const kv = h('dl', 'kv');
    const rows = [
      ['Latitude', a.lat_text], ['Longitude', a.lon_text],
      ['Resolution', a.resolution_nm + ' nm (lat/lon)'],
      ['Model type', a.model === 'G' ? 'G (global)' : 'R (regional)'],
      ['Size', a.size_kb + ' KB']];
    for (const [k, v] of rows) { kv.appendChild(h('dt', null, k)); kv.appendChild(h('dd', null, v)); }
    body.appendChild(kv);
    body.appendChild(h('p', 'hours-label', 'Forecast hours · latest run · opens on the FNMOC portal (CAC)'));
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
    d.addEventListener('toggle', () => { if (d.open) { setSelected(a.id); history.replaceState(null, '', '#' + a.id); } });
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

  // ---------- popup at the click ----------
  const pop = document.getElementById('pop');
  function closePop() { pop.hidden = true; }
  function popDetail(a, back) {
    const d = h('div', 'pop-detail');
    d.appendChild(h('div', 'nm', a.name));
    d.appendChild(h('em', 'id', a.id));
    const kv = h('dl', 'kv');
    for (const [k, v] of [['Lat', a.lat_text], ['Lon', a.lon_text], ['Res', a.resolution_nm + ' nm'], ['Model', a.model === 'G' ? 'G (global, ESPC-D)' : 'R (regional, COAMPS-NCOM)'], ['Fleet', a.fleets.map(f => f.replace(' Fleet', '')).join(', ')], ['Size', a.size_kb + ' KB']]) {
      kv.appendChild(h('dt', null, k)); kv.appendChild(h('dd', null, v));
    }
    d.appendChild(kv);
    d.appendChild(h('p', 'hours-label', 'Forecast hours · latest run · FNMOC portal (CAC)'));
    const hs = h('div', 'hours');
    for (const t of a.hours) { const l = h('a', null, String(t.tau)); l.href = t.url; l.target = '_blank'; l.rel = 'noopener'; hs.appendChild(l); }
    d.appendChild(hs);
    if (back && back.length > 1) {
      const more = h('button', 'pop-more', (back.length - 1) + ' more ' + (back.length === 2 ? 'box covers' : 'boxes cover') + ' this spot…');
      more.type = 'button';
      more.addEventListener('click', () => renderPop(back, null));
      d.appendChild(more);
    }
    setSelected(a.id);
    return d;
  }
  function popChooser(hits) {
    const ul = h('div', 'pop-choose');
    ul.appendChild(h('p', 'hours-label', 'Point to a row to light its box on the map. Click one for its details.'));
    for (const a of hits) {
      const row = h('button', 'pop-row'); row.type = 'button';
      row.appendChild(h('span', 'nm', a.name));
      row.appendChild(h('em', 'id', a.id));
      row.appendChild(h('span', 'ft', (a.model === 'G' ? 'Global' : 'Regional') + ' · ' + a.resolution_nm + ' nm · ' + a.lat_text + ' · ' + a.lon_text));
      row.addEventListener('mouseenter', () => { setHover([a.id]); setSelected(a.id); });
      row.addEventListener('mouseleave', () => setHover([]));
      row.addEventListener('click', () => renderPop(hits, a));
      ul.appendChild(row);
    }
    return ul;
  }
  let popState = null;
  function renderPop(hits, chosen) {
    popState = { hits, chosen };
    const body = pop.querySelector('.pop-body'); body.innerHTML = '';
    pop.querySelector('.pop-title').textContent = chosen ? 'Wavelet area' : (hits.length ? hits.length + ' boxes cover this spot' : 'No area here');
    if (chosen) body.appendChild(popDetail(chosen, hits.length > 1 ? hits : null));
    else if (hits.length) body.appendChild(popChooser(hits));
    else body.appendChild(h('p', 'empty', 'No wavelet area covers this point.'));
  }
  function showPop(cx, cy, lon, lat) {
    const hits = areas.filter(a => visible(a) && contains(a, lon, lat)).sort((x, y) => areaDeg(x) - areaDeg(y));
    pop.innerHTML = '';
    const head = h('div', 'pop-head');
    head.appendChild(h('span', 'pop-title', ''));
    head.appendChild(h('span', 'muted', fmt(lat, 'N', 'S') + ' ' + fmt(lon, 'E', 'W')));
    const x = h('button', 'pop-close', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', closePop);
    head.appendChild(x);
    pop.appendChild(head);
    pop.appendChild(h('div', 'pop-body'));
    renderPop(hits, hits[0] || null);
    pop.hidden = false;
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    const wr = svg.parentElement.getBoundingClientRect();
    const pw = Math.min(380, wr.width - 24), ph = Math.min(pop.offsetHeight, wr.height - 24);
    pop.style.width = pw + 'px';
    pop.style.maxHeight = (wr.height - 24) + 'px';
    // put the window on the other half of the map from the click so the boxes it names stay in view
    const px = cx - wr.left, py = cy - wr.top;
    let left = px < wr.width / 2 ? Math.min(wr.width - pw - 12, px + 140) : Math.max(12, px - pw - 140);
    let top = py - 40;
    if (top + ph > wr.height - 12) top = Math.max(12, wr.height - ph - 12);
    if (top < 12) top = 12;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }

  // ---------- interaction ----------
  let drag = null, moved = false;
  svg.addEventListener('pointerdown', e => {
    e.preventDefault(); // no text selection starts from a map drag
    drag = { x: e.clientX, y: e.clientY, vb: { ...vb } }; moved = false; tip.hidden = true;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (drag) {
      const r = svg.getBoundingClientRect();
      const vbw = parseFloat(svg.getAttribute('viewBox').split(' ')[2]);
      const scale = vbw / r.width;
      const dx = (e.clientX - drag.x) * scale, dy = (e.clientY - drag.y) * scale;
      if (!moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) <= 5) return;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5) moved = true;
      vb = { ...drag.vb, x: drag.vb.x - dx, y: drag.vb.y - dy };
      applyVB(); closePop();
      showCursor(e, toMap(e.clientX, e.clientY));
      return;
    }
    const p = toMap(e.clientX, e.clientY);
    showCursor(e, p);
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
    if (drag && !moved) { const p = toMap(e.clientX, e.clientY); showAt(p.lon, p.lat); showPop(e.clientX, e.clientY, p.lon, p.lat); }
    drag = null;
  });
  svg.addEventListener('pointerleave', () => { setHover([]); tip.hidden = true; cur.hidden = true; });
  function fmtLL(lat, lon) {
    const la = Math.abs(lat).toFixed(1) + (lat < 0 ? 'S' : 'N');
    const lo = Math.abs(lon).toFixed(1) + (lon < 0 ? 'W' : 'E');
    return la + '  ' + lo;
  }
  function showCursor(e, p) {
    if (p.lat > 90 || p.lat < -90) { cur.hidden = true; return; }
    cur.hidden = false;
    cur.textContent = fmtLL(p.lat, p.lon);
    const wr = svg.parentElement.getBoundingClientRect();
    cur.style.left = Math.max(0, Math.min(e.clientX - wr.left + 14, wr.width - 110)) + 'px';
    cur.style.top = Math.max(0, e.clientY - wr.top - 22) + 'px';
  }
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const p = toMap(e.clientX, e.clientY);
    // scale by scroll distance, gently: a trackpad sends many small deltas, a mouse wheel a few large ones
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
    dy = Math.max(-40, Math.min(40, dy));
    const f = Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0025));
    zoomAt(f, p.rawLon, p.lat); closePop();
  }, { passive: false });
  document.getElementById('zin').addEventListener('click', () => zoomAt(0.7));
  document.getElementById('zout').addEventListener('click', () => zoomAt(1.4));
  document.getElementById('zfit').addEventListener('click', homeView);
  window.addEventListener('resize', applyVB);

  const panel = document.getElementById('panel'), railTab = document.getElementById('rail-tab');
  function setRail(open) { panel.hidden = !open; railTab.setAttribute('aria-expanded', String(open)); railTab.textContent = open ? 'HIDE' : 'REGIONS'; applyVB(); }
  railTab.addEventListener('click', () => setRail(panel.hidden));
  document.getElementById('rail-close').addEventListener('click', () => setRail(false));
  search.addEventListener('input', () => { query = search.value.trim(); refreshDim(); showAll(); if (query && panel.hidden) setRail(true); });
  document.getElementById('about-btn').addEventListener('click', () => document.getElementById('about').showModal());
  const themeBtn = document.getElementById('theme-btn');
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    themeBtn.textContent = t === 'night' ? 'Day' : 'Night';
    try { localStorage.setItem('wavelet-theme', t); } catch (e) {}
  }
  let saved = 'day'; try { saved = localStorage.getItem('wavelet-theme') || 'day'; } catch (e) {}
  setTheme(saved);
  themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'night' ? 'day' : 'night'));

  function buildFleets() {
    const fl = [...new Set(areas.flatMap(a => a.fleets))].sort();
    const mk = (label, val) => {
      const b = h('button', 'chip', label); b.type = 'button';
      b.addEventListener('click', () => {
        fleetFilter = val; [...fleetsEl.children].forEach(c => c.classList.toggle('on', c === b));
        refreshDim(); showAll();
        if (val) fitFleet(val); else homeView();
      });
      return b;
    };
    const all = mk('All', null); all.classList.add('on'); fleetsEl.appendChild(all);
    for (const f of fl) fleetsEl.appendChild(mk(f.replace(' Fleet', ''), f));
  }

  // ---------- load ----------
  Promise.all([fetch('data/areas.json').then(r => r.json()), fetch('data/land.geojson').then(r => r.json()), fetch('data/fleets.json').then(r => r.json())])
    .then(([d, land, fl]) => {
      areas = d.areas;
      drawFleets(fl);
      document.getElementById('updated').textContent = areas.length + ' areas · links point at the latest run on the portal';
      drawLand(land); drawGrat(); drawBoxes(); buildFleets(); showAll();
      homeView();
      // #<short name> opens that area and zooms to it (shareable link)
      const want = decodeURIComponent(location.hash.slice(1));
      const hit = areas.find(a => a.id === want);
      if (hit) { hit.item.open = true; hit.item.scrollIntoView(); fit(hit, 1.5); }
    })
    .catch(err => { list.appendChild(h('div', 'empty', 'Could not load the area list: ' + err)); });
})();
