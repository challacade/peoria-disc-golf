import { escapeHtml } from './util.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const pinIcon = (c) => L.divIcon({
  className: 'pin-wrap',
  html: `<span class="pin" data-d="${c.difficulty}"><b>${c.holes}</b></span>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

function baseMap(el, opts = {}) {
  const map = L.map(el, { zoomControl: false, scrollWheelZoom: false, ...opts });
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  // Sticky/responsive layouts resize the container without a window resize event.
  new ResizeObserver(() => map.invalidateSize()).observe(el);
  return map;
}

export function createMap(el, courses, { onSelect }) {
  if (!window.L) return null;
  const map = baseMap(el, { zoomSnap: 0.25, zoomDelta: 0.5 }).setView([40.68, -89.56], 10);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // Avoid hijacking page scroll until the user engages with the map.
  map.on('click focus', () => map.scrollWheelZoom.enable());
  map.on('mouseout blur', () => map.scrollWheelZoom.disable());

  const markers = new Map();
  for (const c of courses) {
    const m = L.marker([c.lat, c.lng], { icon: pinIcon(c), title: c.name, riseOnHover: true, alt: c.name });
    m.bindTooltip(escapeHtml(c.name), { direction: 'top', offset: [0, -18], className: 'pin-tip' });
    m.on('click', () => onSelect(c.id));
    m.addTo(map);
    markers.set(c.id, m);
  }

  let userMarker = null;

  return {
    show(ids) {
      for (const [id, m] of markers) {
        const on = ids.has(id);
        if (on && !map.hasLayer(m)) m.addTo(map);
        else if (!on && map.hasLayer(m)) m.remove();
      }
    },
    fit(ids, animate = true) {
      const pts = [...ids].map((id) => markers.get(id).getLatLng());
      if (userMarker) pts.push(userMarker.getLatLng());
      if (!pts.length) return;
      const bounds = L.latLngBounds(pts).pad(0.12);
      if (!animate) map.fitBounds(bounds, { maxZoom: 13 });
      else if (pts.length === 1) map.flyTo(pts[0], 13, { duration: 0.8 });
      else map.flyToBounds(bounds, { duration: 0.8, maxZoom: 13 });
    },
    highlight(id, on) {
      markers.get(id)?.getElement()?.classList.toggle('is-hot', on);
    },
    setUser(lat, lng) {
      userMarker?.remove();
      userMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: 'pin-wrap', html: '<span class="me-dot"></span>', iconSize: [20, 20], iconAnchor: [10, 10] }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
    },
    invalidate: () => map.invalidateSize(),
  };
}

let mini = null;
export function showMiniMap(el, course) {
  if (!window.L) return;
  if (!mini || mini.el !== el) {
    const map = baseMap(el, { attributionControl: true, dragging: true, doubleClickZoom: true });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mini = { el, map, marker: null };
  }
  mini.marker?.remove();
  mini.marker = L.marker([course.lat, course.lng], { icon: pinIcon(course), keyboard: false }).addTo(mini.map);
  mini.map.invalidateSize();
  mini.map.setView([course.lat, course.lng], 14, { animate: false });
}
