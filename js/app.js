import { COURSES, DIFFICULTY, PEORIA, DATA_UPDATED } from './courses.js';
import { html, raw, milesBetween, fmtFeet, fmtMiles, topoArt, icon } from './util.js';
import { openStatus, daylightLeft, formatClock } from './sun.js';
import { getWeather, compass, describe } from './weather.js';
import { createMap, showMiniMap } from './map.js';
import { initHero } from './hero.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const byId = new Map(COURSES.map((c) => [c.id, c]));
const canTransition = () => typeof document.startViewTransition === 'function' && !reduceMotion.matches;

const state = {
  q: '',
  holes: 'all',
  diff: new Set(),
  flags: new Set(),
  sort: 'distance',
  origin: PEORIA,
  dist: new Map(),
  visible: [],
  current: null,
};

const FLAGS = {
  free: (c) => c.fee === 'Free',
  public: (c) => c.access === 'public',
  openNow: (c) => ['open', 'soon'].includes(openStatus(c)?.state),
  wooded: (c) => c.tags.includes('wooded'),
  hilly: (c) => c.tags.includes('hilly'),
  water: (c) => c.tags.includes('water'),
  open: (c) => c.tags.includes('open'),
  restrooms: (c) => Boolean(c.amenities.restrooms),
};

const dist = (c) => state.dist.get(c.id);
const SORTS = {
  distance: (a, b) => dist(a) - dist(b),
  name: (a, b) => a.name.localeCompare(b.name),
  easy: (a, b) => a.difficulty - b.difficulty || dist(a) - dist(b),
  hard: (a, b) => b.difficulty - a.difficulty || dist(a) - dist(b),
  long: (a, b) => (b.lengthFt ?? -1) - (a.lengthFt ?? -1),
  rating: (a, b) => (b.rating?.score ?? -1) - (a.rating?.score ?? -1) || (b.rating?.votes ?? 0) - (a.rating?.votes ?? 0),
  price: (a, b) => a.price - b.price || dist(a) - dist(b),
  newest: (a, b) => b.established - a.established,
  oldest: (a, b) => a.established - b.established,
};

const haystack = new Map(COURSES.map((c) => [
  c.id,
  [c.name, c.aka, c.city, c.designer, c.operator, c.address, DIFFICULTY[c.difficulty].label, ...c.tags].filter(Boolean).join(' ').toLowerCase(),
]));

const results = $('#results');
const dialog = $('#detail');
const panel = $('#detail-panel');
const content = $('#detail-content');
const minimapEl = $('#minimap');
const cards = new Map();
let map = null;

/* ---------- helpers ---------- */

const feeShort = (c) => (c.fee === 'Free' ? 'Free' : c.price ? `$${c.price}` : 'Private');
const ACCESS = {
  public: ['Public', 'Open to the public'],
  pay: ['Pay to play', 'Open to the public, fee required'],
  private: ['Private', 'Private property. Get permission first.'],
};
const originLabel = () => (state.origin === PEORIA ? 'from downtown Peoria' : 'from you');
const isInViewport = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
};

function pips(level) {
  return html`<span class="pips" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => html`<i class="${i <= level ? 'on' : ''}"></i>`)}</span>`;
}

function sunLine(lat, lng) {
  const s = daylightLeft(lat, lng);
  if (s.phase === 'day') {
    const h = Math.floor(s.minutes / 60);
    const m = s.minutes % 60;
    return `Sunset ${formatClock(s.sunset)} · ${h ? `${h}h ` : ''}${m}m of daylight left`;
  }
  if (s.phase === 'night') return 'Sun is down. Glow rounds only';
  return `Sunrise at ${formatClock(s.sunrise)}`;
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

async function copy(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    toast('Copy failed. Select the text instead.');
  }
}

/* ---------- cards ---------- */

function cardHTML(c) {
  const diff = DIFFICULTY[c.difficulty];
  const terrain = [
    ['wooded', 'tree', 'Wooded'], ['hilly', 'hill', 'Hilly'], ['water', 'water', 'Water in play'], ['open', 'open', 'Open fairways'],
  ].filter(([t]) => c.tags.includes(t));
  return html`
    <article class="card" data-id="${c.id}" data-d="${c.difficulty}">
      <div class="card-art">
        ${raw(topoArt(c))}
        <span class="card-holes"><b>${c.holes}</b>holes</span>
        <span class="card-status" data-status hidden></span>
      </div>
      <div class="card-body">
        <p class="card-meta">${raw(icon('pin'))}<span>${c.city}</span><span class="sep" aria-hidden="true">·</span><span data-dist></span></p>
        <h3 class="card-title"><a class="card-link" href="?course=${c.id}">${c.name}</a></h3>
        ${c.aka ? html`<p class="card-aka">“${c.aka}”</p>` : ''}
        <div class="card-diff">${pips(c.difficulty)}<span><span class="sr-only">Difficulty: </span>${diff.label}</span></div>
        <ul class="card-chips">
          <li class="${c.fee === 'Free' ? 'free' : 'paid'}">${feeShort(c)}</li>
          ${c.lengthFt ? html`<li>${fmtFeet(c.lengthFt)}</li>` : ''}
          ${terrain.map(([, ic, label]) => html`<li class="ico" title="${label}">${raw(icon(ic))}<span class="sr-only">${label}</span></li>`)}
        </ul>
      </div>
    </article>`;
}

function buildCards() {
  results.innerHTML = COURSES.map(cardHTML).join('');
  for (const el of $$('.card', results)) cards.set(el.dataset.id, el);
}

// Cards carry view-transition names only while reordering, so a dialog morph animates a single layer.
let reorderToken = 0;
function nameCards(on) {
  reorderToken += 1;
  for (const [id, el] of cards) el.style.viewTransitionName = on ? `card-${id}` : '';
  return reorderToken;
}

function renderDistances() {
  for (const c of COURSES) {
    const el = $('[data-dist]', cards.get(c.id));
    el.textContent = `${fmtMiles(dist(c))} mi`;
    el.title = originLabel();
  }
}

function renderStatuses() {
  for (const c of COURSES) {
    const el = $('[data-status]', cards.get(c.id));
    const s = openStatus(c);
    el.hidden = !s;
    if (s) {
      el.textContent = s.label;
      el.dataset.state = s.state;
    }
  }
}

function computeDistances() {
  for (const c of COURSES) state.dist.set(c.id, milesBetween(state.origin, c));
}

/* ---------- filtering ---------- */

function matches(c) {
  if (state.holes !== 'all' && c.holes !== Number(state.holes)) return false;
  if (state.diff.size && !state.diff.has(c.difficulty)) return false;
  for (const f of state.flags) if (!FLAGS[f](c)) return false;
  if (state.q) {
    const hay = haystack.get(c.id);
    if (!state.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
  }
  return true;
}

const isFiltered = () => state.q || state.holes !== 'all' || state.diff.size || state.flags.size;

function apply({ animate = true, fit = true } = {}) {
  const visible = COURSES.filter(matches).sort(SORTS[state.sort]);
  const unchanged = visible.length === state.visible.length && visible.every((c, i) => c === state.visible[i]);
  state.visible = visible;
  const ids = new Set(visible.map((c) => c.id));

  const update = () => {
    for (const [id, el] of cards) el.hidden = !ids.has(id);
    results.append(...visible.map((c) => cards.get(c.id)));
    $('#empty').hidden = visible.length > 0;
    const n = visible.length;
    $('#count').textContent = n === COURSES.length ? `All ${n} courses` : `${n} of ${COURSES.length} courses`;
    $('#reset').hidden = !isFiltered();
    map?.show(ids);
  };

  if (animate && !unchanged && canTransition() && isInViewport(results)) {
    const token = nameCards(true);
    document.startViewTransition(update).finished.finally(() => {
      if (token === reorderToken) nameCards(false);
    });
  } else update();
  if (fit && !unchanged) map?.fit(ids);
}

function resetFilters() {
  state.q = '';
  state.holes = 'all';
  state.diff.clear();
  state.flags.clear();
  $('#q').value = '';
  $('input[name="holes"][value="all"]').checked = true;
  for (const chip of $$('.chip[aria-pressed]')) chip.setAttribute('aria-pressed', 'false');
  apply();
}

/* ---------- detail dialog ---------- */

function fact(label, value) {
  return value ? html`<div><dt>${label}</dt><dd>${value}</dd></div>` : '';
}

function holeMixHTML(c) {
  const mix = c.holeMix;
  const total = mix ? mix.reduce((a, b) => a + b, 0) : 0;
  if (!total) return html`<p class="muted">Hole-by-hole distances aren't reported for this course.</p>`;
  const labels = ['Under 300 ft', '300–400 ft', 'Over 400 ft'];
  let n = 0;
  const dots = mix.flatMap((count, bucket) => Array.from({ length: count }, () => {
    n += 1;
    return html`<i class="b${bucket}" style="--i:${n}" title="${labels[bucket]}"></i>`;
  }));
  return html`
    <div class="hole-dots" aria-hidden="true">${dots}</div>
    <div class="hole-bar" role="img" aria-label="${mix.map((v, i) => `${v} holes ${labels[i].toLowerCase()}`).join(', ')}">
      ${mix.map((v, i) => (v ? html`<span class="b${i}" style="--w:${((v / total) * 100).toFixed(2)}%"></span>` : ''))}
    </div>
    <ul class="hole-legend">${mix.map((v, i) => html`<li><i class="b${i}"></i>${labels[i]}<b>${v}</b></li>`)}</ul>`;
}

function amenitiesHTML(c) {
  const a = c.amenities;
  const item = (ic, label, v) => {
    const cls = v === true || (typeof v === 'string' && v) ? 'yes' : v === false ? 'no' : 'unknown';
    const text = typeof v === 'string' ? v : v === true ? 'Yes' : v === false ? 'No' : 'Unknown';
    return html`<li class="${cls}">${raw(icon(ic))}<span>${label}</span><small>${text}</small></li>`;
  };
  return html`<ul class="amenities">
    ${item('restroom', 'Restrooms', a.restrooms)}
    ${item('sign', 'Tee signs', a.teeSigns)}
    ${item('access', 'Accessible', a.accessible)}
    ${item('camp', 'Camping', a.camping)}
    ${a.cartFriendly ? item('cart', 'Carts', a.cartFriendly) : ''}
  </ul>`;
}

function detailHTML(c) {
  const diff = DIFFICULTY[c.difficulty];
  const s = openStatus(c);
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
  const amaps = `https://maps.apple.com/?daddr=${c.lat},${c.lng}&q=${encodeURIComponent(c.name)}`;
  const [accessShort, accessLong] = ACCESS[c.access];
  const hoursMeta = c.hours.verified
    ? html`<small class="src">Source: ${c.hours.source}</small>`
    : html`<span class="tag-unverified" title="Not published by the operator. Confirm before you go.">unverified</span>`;
  const updated = new Date(`${DATA_UPDATED}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return html`
    <header class="detail-hero" data-d="${c.difficulty}">
      ${raw(topoArt(c, { w: 800, h: 320 }))}
      <div class="detail-hero-inner">
        <p class="eyebrow">${raw(icon('pin'))} ${c.city} · ${fmtMiles(dist(c))} mi ${originLabel()}</p>
        <h2 id="detail-title">${c.name}</h2>
        ${c.aka ? html`<p class="detail-aka">“${c.aka}”</p>` : ''}
        <div class="detail-badges">
          <span class="badge diff" data-d="${c.difficulty}">${pips(c.difficulty)}${diff.label}</span>
          <span class="badge">${accessShort}</span>
          ${s ? html`<span class="badge status" data-state="${s.state}">${s.label}</span>` : ''}
        </div>
        <div class="detail-actions">
          <a class="btn primary sm" href="${gmaps}" target="_blank" rel="noopener noreferrer">${raw(icon('route'))}Directions</a>
          <button class="btn ghost sm" type="button" data-share>${raw(icon('share'))}Share</button>
        </div>
      </div>
    </header>

    <dl class="stat-strip">
      <div><dt>Holes</dt><dd>${c.holes}</dd></div>
      <div><dt>Length</dt><dd>${c.lengthFt ? html`${c.lengthFt.toLocaleString('en-US')}<small> ft</small>` : html`<small>Not listed</small>`}</dd></div>
      <div><dt>Established</dt><dd>${c.established}</dd></div>
      ${c.par ? html`<div><dt>Par</dt><dd>${c.par}</dd></div>` : ''}
      <div><dt>PDGA rating</dt><dd>${c.rating ? html`${c.rating.score.toFixed(1)}<small> / 5 · ${c.rating.votes} vote${c.rating.votes > 1 ? 's' : ''}</small>` : html`<small>No votes yet</small>`}</dd></div>
    </dl>

    <div class="detail-grid">
      <div class="detail-main">
        <section class="block">
          <h3>At a glance</h3>
          <dl class="facts">
            <div><dt>${raw(icon('dollar'))}Price</dt><dd>${c.fee}</dd></div>
            <div><dt>${raw(icon('clock'))}Hours</dt><dd>
              <span>${c.hours.text}</span> ${hoursMeta}
              ${s ? html`<span class="status-line" data-state="${s.state}">${s.label} · ${s.detail}</span>` : ''}
              <small class="muted">${sunLine(c.lat, c.lng)}</small>
            </dd></div>
            <div><dt>${raw(icon('pin'))}Access</dt><dd>${accessLong}</dd></div>
            ${fact('Operator', c.operator)}
            ${c.phone ? html`<div><dt>${raw(icon('phone'))}Phone</dt><dd><a href="tel:+1${c.phone.replace(/\D/g, '')}">${c.phone}</a></dd></div>` : ''}
          </dl>
        </section>

        <section class="block">
          <h3>About the course</h3>
          <p>${c.description}</p>
          ${c.notes.length ? html`<ul class="notes">${c.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ''}
        </section>

        <section class="block">
          <h3>Hole lengths</h3>
          ${holeMixHTML(c)}
        </section>

        <section class="block">
          <h3>Course details</h3>
          <dl class="facts two">
            ${fact('Targets', c.targets)}
            ${fact('Tee pads', c.tees)}
            ${fact('Terrain', c.elevation)}
            ${fact('Foliage', c.foliage)}
            ${fact('Designer', c.designer)}
            ${fact('Long tees', fmtFeet(c.altLengthFt))}
          </dl>
        </section>

        <section class="block">
          <h3>Amenities</h3>
          ${amenitiesHTML(c)}
        </section>
      </div>

      <aside class="detail-side">
        <div data-minimap></div>
        <section class="block">
          <h3>Getting there</h3>
          <p class="address"><span>${c.address}</span>
            <button class="icon-btn sm" type="button" data-copy="${c.address}" aria-label="Copy address">${raw(icon('copy'))}</button></p>
          <p class="directions">${c.directions}</p>
          <div class="btn-row">
            <a class="btn ghost sm" href="${gmaps}" target="_blank" rel="noopener noreferrer">Google Maps${raw(icon('external'))}</a>
            <a class="btn ghost sm" href="${amaps}" target="_blank" rel="noopener noreferrer">Apple Maps${raw(icon('external'))}</a>
          </div>
        </section>

        <section class="block weather" data-weather aria-live="polite" aria-busy="true">
          <h3>Conditions right now</h3>
          <div class="wx-skeleton"><i></i><i></i><i></i></div>
        </section>

        <section class="block">
          <h3>Links</h3>
          <ul class="links">${c.links.map((l) => html`<li><a href="${l.url}" target="_blank" rel="noopener noreferrer">${l.label}${raw(icon('external'))}</a></li>`)}</ul>
        </section>
      </aside>
    </div>
    <p class="detail-foot">Difficulty is our estimate. Course details are from PDGA, OpenStreetMap and operator websites, last checked ${updated}. Conditions change, so confirm with the operator before a long drive.</p>`;
}

const hourLabel = (iso, i) => {
  if (i === 0) return 'Now';
  const h = Number(iso.slice(11, 13));
  return `${((h + 11) % 12) + 1}${h >= 12 ? 'p' : 'a'}`;
};

function weatherHTML(wx, c) {
  const { now, hourly, throwIndex } = wx;
  const desc = describe(now.code);
  const arc = 125.66; // length of the gauge's semicircle path (π × r40)
  return html`
    <h3>Conditions right now</h3>
    <div class="wx-now">
      <div class="wx-temp">${raw(icon(desc.icon, 'lg'))}<b>${Math.round(now.temp)}°</b><span>${desc.label}<small>Feels like ${Math.round(now.feels)}°</small></span></div>
      <div class="wx-wind">
        <span class="wind-arrow" style="--deg:${(now.dir + 180) % 360}deg">${raw(icon('arrow'))}</span>
        <span><span><b>${Math.round(now.wind)}</b> mph ${compass(now.dir)}</span><small>Gusts ${Math.round(now.gust)} mph</small></span>
      </div>
    </div>
    <div class="throw-index" data-score="${throwIndex.score >= 70 ? 'good' : throwIndex.score >= 45 ? 'ok' : 'bad'}">
      <svg viewBox="0 0 100 56" class="gauge" aria-hidden="true">
        <path d="M10 50a40 40 0 0 1 80 0" class="track"/>
        <path d="M10 50a40 40 0 0 1 80 0" class="fill" style="stroke-dasharray:${((throwIndex.score / 100) * arc).toFixed(1)} 200"/>
      </svg>
      <div><b>${throwIndex.score}</b><span>Throw index</span><small>${throwIndex.verdict}</small></div>
    </div>
    <ol class="hourly" aria-label="Next 12 hours">
      ${hourly.map((h, i) => html`<li>
        <span class="h-time">${hourLabel(h.time, i)}</span>
        ${raw(icon(describe(h.code).icon))}
        <span class="h-temp">${Math.round(h.temp)}°</span>
        <span class="wind-arrow sm" style="--deg:${(h.dir + 180) % 360}deg" title="Wind from ${compass(h.dir)}">${raw(icon('arrow'))}</span>
        <span class="h-wind">${Math.round(h.wind)}<small>mph</small></span>
        <span class="h-pop" style="--p:${h.pop}%">${h.pop}%</span>
      </li>`)}
    </ol>
    <p class="wx-sun">${raw(icon('sun'))}${sunLine(c.lat, c.lng)}</p>
    <p class="fine">Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>. The throw index is our just-for-fun mix of wind, rain and temperature.</p>`;
}

async function loadWeather(c) {
  const box = $('[data-weather]', content);
  try {
    const wx = await getWeather(c.lat, c.lng);
    if (state.current !== c.id || !box.isConnected) return;
    box.innerHTML = weatherHTML(wx, c);
  } catch {
    if (box.isConnected) box.innerHTML = html`<h3>Conditions right now</h3><p class="muted">Live weather isn't available right now.</p>`;
  } finally {
    box.removeAttribute('aria-busy');
  }
}

function render(c) {
  panel.append(minimapEl);
  panel.dataset.d = c.difficulty;
  content.innerHTML = detailHTML(c);
  $('[data-minimap]', content)?.replaceWith(minimapEl);
  const idx = state.visible.findIndex((v) => v.id === c.id);
  $('#detail-pos').textContent = idx >= 0 ? `${idx + 1} of ${state.visible.length}` : '';
  panel.scrollTop = 0;
}

function openCourse(id, { push = true, from = null } = {}) {
  const c = byId.get(id);
  if (!c) return;
  const wasOpen = dialog.open;
  state.current = id;
  const show = () => {
    render(c);
    if (!dialog.open) dialog.showModal();
    showMiniMap(minimapEl, c);
    loadWeather(c);
  };

  if (!wasOpen && from && !from.hidden && canTransition()) {
    nameCards(false);
    from.style.viewTransitionName = 'active-card';
    dialog.classList.add('no-anim');
    document.startViewTransition(() => {
      from.style.viewTransitionName = '';
      panel.style.viewTransitionName = 'active-card';
      show();
    }).finished.finally(() => {
      dialog.classList.remove('no-anim');
      panel.style.viewTransitionName = '';
    });
  } else {
    show();
    if (wasOpen && !reduceMotion.matches) {
      content.classList.remove('swap');
      void content.offsetWidth;
      content.classList.add('swap');
    }
  }

  const url = `?course=${encodeURIComponent(id)}`;
  if (wasOpen) history.replaceState({ course: id }, '', url);
  else if (push) history.pushState({ course: id }, '', url);
  document.title = `${c.name} · Peoria Disc Golf`;
}

function closeDialog() {
  if (!dialog.open) return;
  const card = cards.get(state.current);
  const done = () => {
    dialog.close();
    panel.style.viewTransitionName = '';
    state.current = null;
  };
  if (card && !card.hidden && isInViewport(card) && canTransition()) {
    panel.style.viewTransitionName = 'active-card';
    dialog.classList.add('no-anim');
    document.startViewTransition(() => {
      done();
      card.style.viewTransitionName = 'active-card';
    }).finished.finally(() => {
      dialog.classList.remove('no-anim');
      card.style.viewTransitionName = '';
    });
  } else done();
  if (new URLSearchParams(location.search).has('course')) history.replaceState(null, '', location.pathname + location.hash);
  document.title = 'Peoria Disc Golf · Every course in the Greater Peoria area';
}

function requestClose() {
  if (history.state?.course) history.back();
  else closeDialog();
}

function navigate(delta) {
  const list = state.visible.length ? state.visible : COURSES;
  const i = list.findIndex((c) => c.id === state.current);
  openCourse(list[(i + delta + list.length) % list.length].id);
}

async function share(c) {
  const url = new URL(`?course=${encodeURIComponent(c.id)}`, location.href).href;
  if (navigator.share) {
    try {
      await navigator.share({ title: c.name, text: `${c.name}: disc golf in ${c.city}, IL`, url });
    } catch { /* user dismissed the share sheet */ }
    return;
  }
  copy(url, 'Link copied');
}

/* ---------- hero extras ---------- */

function countUp() {
  const holes = COURSES.reduce((a, c) => a + c.holes, 0);
  const miles = COURSES.reduce((a, c) => a + (c.lengthFt || 0), 0) / 5280;
  const oldest = Math.min(...COURSES.map((c) => c.established));
  $('#stat-courses-inline').textContent = COURSES.length;
  const targets = [['stat-courses', COURSES.length, 0], ['stat-holes', holes, 0], ['stat-miles', miles, 0], ['stat-oldest', oldest, new Date().getFullYear()]];
  for (const [id, to, from] of targets) {
    const el = document.getElementById(id);
    const dec = Number(el.dataset.decimals || 0);
    const plain = 'plain' in el.dataset;
    const fmt = (v) => (plain ? String(Math.round(v)) : v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
    if (reduceMotion.matches) {
      el.textContent = fmt(to);
      continue;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const x = Math.min(1, (now - t0) / 1800);
      el.textContent = fmt(from + (to - from) * (1 - (1 - x) ** 3));
      if (x < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

async function heroConditions() {
  const el = $('#conditions .cond-text');
  const sun = sunLine(PEORIA.lat, PEORIA.lng);
  try {
    const wx = await getWeather(PEORIA.lat, PEORIA.lng);
    const d = describe(wx.now.code);
    el.innerHTML = html`<b>${Math.round(wx.now.temp)}°F</b> ${d.label}<span class="sep">·</span>Wind ${Math.round(wx.now.wind)} mph ${compass(wx.now.dir)}<span class="sep">·</span>Throw index <b class="ti">${wx.throwIndex.score}</b><span class="sep">·</span>${sun}`;
    $('#conditions').dataset.ready = '';
  } catch {
    el.textContent = sun;
  }
}

function buildLegends() {
  const levels = [1, 2, 3, 4, 5];
  $('#diff-chips').innerHTML = levels.map((i) => html`<button class="chip diff" type="button" aria-pressed="false" data-diff="${i}" data-d="${i}"><i class="swatch"></i>${DIFFICULTY[i].label}</button>`).join('');
  $('#map-legend').innerHTML = levels.map((i) => html`<span data-d="${i}"><i class="swatch"></i>${DIFFICULTY[i].label}</span>`).join('');
  $('#diff-legend').innerHTML = levels.map((i) => {
    const n = COURSES.filter((c) => c.difficulty === i).length;
    return html`<li data-d="${i}"><i class="swatch"></i><div><b>${DIFFICULTY[i].label}</b> <small>${n} course${n === 1 ? '' : 's'}</small><p>${DIFFICULTY[i].blurb}</p></div></li>`;
  }).join('');
  const updated = $('#data-updated');
  updated.dateTime = DATA_UPDATED;
  updated.textContent = new Date(`${DATA_UPDATED}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/* ---------- events ---------- */

function wire() {
  let qTimer = 0;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = e.target.value.trim();
      apply();
    }, 160);
  });

  for (const r of $$('input[name="holes"]')) {
    r.addEventListener('change', () => {
      state.holes = r.value;
      apply();
    });
  }

  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    apply();
  });

  $('.toolbar').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[aria-pressed]');
    if (!chip) return;
    const on = chip.getAttribute('aria-pressed') !== 'true';
    chip.setAttribute('aria-pressed', String(on));
    if (chip.dataset.diff) {
      const v = Number(chip.dataset.diff);
      if (on) state.diff.add(v); else state.diff.delete(v);
    } else if (on) state.flags.add(chip.dataset.flag);
    else state.flags.delete(chip.dataset.flag);
    apply();
  });

  $('#reset').addEventListener('click', resetFilters);
  $('[data-reset]').addEventListener('click', resetFilters);

  $('#near-me').addEventListener('click', () => {
    const btn = $('#near-me');
    if (!navigator.geolocation) return toast('Location isn’t available in this browser');
    btn.classList.add('busy');
    navigator.geolocation.getCurrentPosition((pos) => {
      btn.classList.remove('busy');
      btn.classList.add('active');
      state.origin = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'you' };
      computeDistances();
      renderDistances();
      state.sort = 'distance';
      $('#sort').value = 'distance';
      map?.setUser(state.origin.lat, state.origin.lng);
      apply({ fit: false });
      map?.fit(new Set(state.visible.map((c) => c.id)));
      toast('Sorted by distance from you');
    }, () => {
      btn.classList.remove('busy');
      toast('Couldn’t get your location');
    }, { timeout: 10000, maximumAge: 300000 });
  });

  $('#surprise').addEventListener('click', () => {
    const pool = state.visible.length ? state.visible : COURSES;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const card = cards.get(pick.id);
    if (card.hidden) return openCourse(pick.id);
    card.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'center' });
    card.classList.add('picked');
    setTimeout(() => {
      card.classList.remove('picked');
      openCourse(pick.id, { from: card });
    }, reduceMotion.matches ? 0 : 750);
  });

  results.addEventListener('click', (e) => {
    const link = e.target.closest('.card-link');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const card = link.closest('.card');
    openCourse(card.dataset.id, { from: card });
  });

  results.addEventListener('pointerover', (e) => {
    const card = e.target.closest('.card');
    if (card && !card.contains(e.relatedTarget)) map?.highlight(card.dataset.id, true);
  });
  results.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.card');
    if (!card || card.contains(e.relatedTarget)) return;
    map?.highlight(card.dataset.id, false);
    for (const p of ['--rx', '--ry', '--gx', '--gy']) card.style.removeProperty(p);
  });
  results.addEventListener('focusin', (e) => map?.highlight(e.target.closest('.card')?.dataset.id, true));
  results.addEventListener('focusout', (e) => map?.highlight(e.target.closest('.card')?.dataset.id, false));

  if (finePointer.matches && !reduceMotion.matches) {
    results.addEventListener('pointermove', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--rx', `${((0.5 - y) * 7).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${((x - 0.5) * 9).toFixed(2)}deg`);
      card.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
    });
  }

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) return requestClose();
    const t = e.target.closest('[data-close], [data-nav], [data-copy], [data-share]');
    if (!t) return;
    if ('close' in t.dataset) requestClose();
    else if (t.dataset.nav) navigate(Number(t.dataset.nav));
    else if (t.dataset.copy) copy(t.dataset.copy, 'Address copied');
    else if ('share' in t.dataset) share(byId.get(state.current));
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.target.matches('input, textarea, select') || e.target.closest('.leaflet-container')) return;
    if (e.key === 'ArrowRight') navigate(1);
    else if (e.key === 'ArrowLeft') navigate(-1);
  });

  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('course');
    if (id && byId.has(id)) openCourse(id, { push: false });
    else closeDialog();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || dialog.open || e.target.matches('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    $('#q').focus();
  });

  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty('--toolbar-h', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`);
  }).observe($('#toolbar'));
}

/* ---------- boot ---------- */

computeDistances();
buildCards();
buildLegends();
renderDistances();
renderStatuses();
document.documentElement.style.setProperty('--toolbar-h', `${Math.ceil($('#toolbar').getBoundingClientRect().height)}px`);
map = createMap($('#map'), COURSES, { onSelect: (id) => openCourse(id) });
if (!map) $('#map-anchor').hidden = true;
apply({ animate: false, fit: false });
map?.fit(new Set(COURSES.map((c) => c.id)), false);
wire();
initHero();
countUp();
heroConditions();
setInterval(renderStatuses, 60_000);

const deepLink = new URLSearchParams(location.search).get('course');
if (deepLink && byId.has(deepLink)) openCourse(deepLink, { push: false });
