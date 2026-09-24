const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);

/** Tagged template that escapes interpolations; nested html`` results and raw() pass through. */
export function html(strings, ...values) {
  const out = strings.reduce((acc, str, i) => {
    if (i === 0) return str;
    const v = values[i - 1];
    const piece = Array.isArray(v) ? v.map(unwrap).join('') : unwrap(v);
    return acc + piece + str;
  }, '');
  return raw(out);
}
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: String(s), toString() { return this[RAW]; } });
const unwrap = (v) => (v && typeof v === 'object' && RAW in v ? v[RAW] : v === false || v == null ? '' : escapeHtml(v));

export function milesBetween(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const fmtFeet = (ft) => (ft ? `${ft.toLocaleString('en-US')} ft` : null);
export const fmtMiles = (mi) => (mi < 10 ? mi.toFixed(1) : Math.round(mi).toString());

function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blob(cx, cy, r, rand, wobble = 0.18, points = 56) {
  const k = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const a = [wobble * rand(), wobble * 0.6 * rand(), wobble * 0.4 * rand()];
  let d = '';
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * Math.PI * 2;
    const rr = r * (1 + a[0] * Math.sin(2 * t + k[0]) + a[1] * Math.sin(3 * t + k[1]) + a[2] * Math.sin(5 * t + k[2]));
    d += `${i ? 'L' : 'M'}${(cx + rr * Math.cos(t)).toFixed(1)} ${(cy + rr * 0.62 * Math.sin(t)).toFixed(1)}`;
  }
  return `${d}Z`;
}

/**
 * Generative "topo map" artwork unique to each course.
 * Hills add contour rings, woods add tree clusters, water adds a pond.
 */
export function topoArt(course, { w = 400, h = 220 } = {}) {
  const rand = rng(hash(course.id));
  const tags = new Set(course.tags);
  const peaks = tags.has('hilly') ? 3 : 2;
  const ringsPer = tags.has('hilly') ? 7 : 4;
  let svg = '';

  for (let p = 0; p < peaks; p++) {
    const cx = w * (0.15 + rand() * 0.7);
    const cy = h * (0.2 + rand() * 0.6);
    const base = 18 + rand() * 18;
    for (let i = ringsPer; i >= 1; i--) {
      const op = (0.12 + (1 - i / ringsPer) * 0.5).toFixed(2);
      svg += `<path d="${blob(cx, cy, base + i * (14 + rand() * 6), rand)}" fill="none" stroke="currentColor" stroke-opacity="${op}" stroke-width="1.1"/>`;
    }
  }

  if (tags.has('water')) {
    const cx = w * (0.2 + rand() * 0.6);
    const cy = h * (0.3 + rand() * 0.4);
    svg += `<path d="${blob(cx, cy, 26 + rand() * 16, rand, 0.25)}" fill="#3fb8ff" fill-opacity="0.22" stroke="#7fd4ff" stroke-opacity="0.6" stroke-width="1"/>`;
  }

  if (tags.has('wooded')) {
    for (let g = 0; g < 4; g++) {
      const gx = w * rand();
      const gy = h * rand();
      for (let t = 0; t < 7; t++) {
        const x = gx + (rand() - 0.5) * 60;
        const y = gy + (rand() - 0.5) * 34;
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2 + rand() * 3).toFixed(1)}" fill="#8cffb0" fill-opacity="0.28"/>`;
      }
    }
  }

  // A dashed fairway line from tee to basket.
  const tx = w * (0.08 + rand() * 0.2);
  const ty = h * (0.55 + rand() * 0.35);
  const bx = w * (0.72 + rand() * 0.2);
  const by = h * (0.15 + rand() * 0.35);
  const qx = w * (0.3 + rand() * 0.4);
  const qy = h * (rand() * 0.3);
  svg += `<path d="M${tx.toFixed(1)} ${ty.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="1.6" stroke-dasharray="2 6" stroke-linecap="round"/>`;
  svg += `<rect x="${(tx - 5).toFixed(1)}" y="${(ty - 3).toFixed(1)}" width="10" height="6" rx="1.5" fill="#fff" fill-opacity="0.85"/>`;
  svg += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="5" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="1.8" fill="#fff"/>`;

  return `<svg class="topo" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${svg}</svg>`;
}

export const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
