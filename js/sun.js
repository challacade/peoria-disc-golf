const RAD = Math.PI / 180;
const TZ = 'America/Chicago';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });

/** Calendar date + minutes-past-midnight in Central time. */
export function centralParts(date = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, minutes: (+p.hour % 24) * 60 + +p.minute };
}

export const formatClock = (date) => clockFmt.format(date);

export function formatMinutes(min) {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** NOAA solar equations: sunrise/sunset for a local calendar day. */
export function sunTimes(lat, lng, date = new Date()) {
  const { y, m, d } = centralParts(date);
  const start = Date.UTC(y, m - 1, d);
  const dayOfYear = Math.round((start - Date.UTC(y, 0, 0)) / 864e5);
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  const ha = Math.acos(Math.min(1, Math.max(-1, cosH))) / RAD;
  return {
    sunrise: new Date(start + (720 - 4 * (lng + ha) - eqTime) * 6e4),
    sunset: new Date(start + (720 - 4 * (lng - ha) - eqTime) * 6e4),
  };
}

const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** Open/closed status for courses with structured hours; null when hours aren't known. */
export function openStatus(course, now = new Date()) {
  const h = course.hours;
  if (!h || !h.open || !h.close) return null;
  const sun = sunTimes(course.lat, course.lng, now);
  const resolve = (v) => (v === 'sunrise' ? centralParts(sun.sunrise).minutes
    : v === 'sunset' ? centralParts(sun.sunset).minutes : hm(v));
  const openAt = resolve(h.open);
  const closeAt = resolve(h.close);
  const nowMin = centralParts(now).minutes;
  const isOpen = nowMin >= openAt && nowMin < closeAt;
  const closeLabel = h.close === 'sunset' ? `dusk (${formatMinutes(closeAt)})` : formatMinutes(closeAt);
  const openLabel = h.open === 'sunrise' ? `sunrise (${formatMinutes(openAt)})` : formatMinutes(openAt);
  if (isOpen) {
    const left = closeAt - nowMin;
    return { state: left <= 60 ? 'soon' : 'open', label: left <= 60 ? `Closes in ${left} min` : 'Open now', detail: `Closes at ${closeLabel}` };
  }
  return { state: 'closed', label: 'Closed', detail: nowMin < openAt ? `Opens at ${openLabel}` : `Opens tomorrow at ${h.open === 'sunrise' ? 'sunrise' : formatMinutes(openAt)}` };
}

export function daylightLeft(lat, lng, now = new Date()) {
  const { sunrise, sunset } = sunTimes(lat, lng, now);
  if (now < sunrise) return { phase: 'predawn', sunrise, sunset };
  if (now > sunset) return { phase: 'night', sunrise, sunset };
  return { phase: 'day', minutes: Math.round((sunset - now) / 6e4), sunrise, sunset };
}
