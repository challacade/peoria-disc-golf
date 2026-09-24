const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const TTL = 10 * 60 * 1000;
const cache = new Map();

export async function getWeather(lat, lng) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.promise;

  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,weather_code',
    daily: 'sunrise,sunset',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'America/Chicago',
    forecast_days: '2',
  });

  const promise = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Weather request failed (${r.status})`);
    return r.json();
  }).then(shape);
  cache.set(key, { t: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

function shape(data) {
  const c = data.current;
  const hourKey = c.time.slice(0, 13);
  let start = data.hourly.time.findIndex((t) => t.slice(0, 13) >= hourKey);
  if (start < 0) start = 0;
  const hourly = data.hourly.time.slice(start, start + 12).map((t, i) => ({
    time: t,
    temp: data.hourly.temperature_2m[start + i],
    pop: data.hourly.precipitation_probability[start + i] ?? 0,
    wind: data.hourly.wind_speed_10m[start + i],
    dir: data.hourly.wind_direction_10m[start + i],
    code: data.hourly.weather_code[start + i],
  }));
  const now = {
    temp: c.temperature_2m,
    feels: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    precip: c.precipitation,
    code: c.weather_code,
    wind: c.wind_speed_10m,
    gust: c.wind_gusts_10m,
    dir: c.wind_direction_10m,
  };
  return { now, hourly, throwIndex: throwIndex(now, hourly) };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

export function describe(code) {
  if (code === 0) return { label: 'Clear', icon: 'sun' };
  if (code <= 2) return { label: code === 1 ? 'Mostly clear' : 'Partly cloudy', icon: 'partly' };
  if (code === 3) return { label: 'Overcast', icon: 'cloud' };
  if (code <= 48) return { label: 'Fog', icon: 'cloud' };
  if (code <= 57) return { label: 'Drizzle', icon: 'rain' };
  if (code <= 67) return { label: 'Rain', icon: 'rain' };
  if (code <= 77) return { label: 'Snow', icon: 'snow' };
  if (code <= 82) return { label: 'Showers', icon: 'rain' };
  if (code <= 86) return { label: 'Snow showers', icon: 'snow' };
  return { label: 'Thunderstorms', icon: 'storm' };
}

/** A playful 0-100 "how good is it to throw right now" score. */
export function throwIndex(now, hourly) {
  let s = 100;
  s -= Math.max(0, now.wind - 6) * 3;
  s -= Math.max(0, now.gust - 15) * 1.2;
  if (now.precip > 0) s -= 30;
  const soonPop = hourly.slice(0, 3).reduce((a, h) => a + h.pop, 0) / Math.max(1, Math.min(3, hourly.length));
  s -= soonPop * 0.3;
  if (now.temp < 55) s -= (55 - now.temp) * 1.4;
  if (now.temp > 85) s -= (now.temp - 85) * 2;
  if (now.code >= 95) s -= 40;
  const score = Math.round(Math.max(0, Math.min(100, s)));
  const verdict = score >= 85 ? 'Prime throwing weather'
    : score >= 70 ? 'Solid day for a round'
      : score >= 50 ? 'Playable, bring layers'
        : score >= 30 ? 'Tough conditions'
          : 'Maybe putt in the garage';
  return { score, verdict };
}
