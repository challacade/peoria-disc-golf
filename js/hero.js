const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SVGNS = 'http://www.w3.org/2000/svg';

export function initHero() {
  const hero = document.querySelector('.hero');
  const path = document.getElementById('flight-path');
  const trail = document.getElementById('flight-trail');
  const disc = document.getElementById('disc');
  const basket = document.getElementById('basket');
  const sparks = document.getElementById('sparks');
  const ching = document.getElementById('ching');
  if (!hero || !path) return { throwDisc() {} };

  makeStars(document.getElementById('stars'));

  const len = path.getTotalLength();
  trail.style.strokeDasharray = `${len}`;
  trail.style.strokeDashoffset = `${len}`;
  let raf = 0;
  let timer = 0;

  const place = (t) => {
    const at = t * len;
    const p = path.getPointAtLength(at);
    const q = path.getPointAtLength(Math.min(len, at + 2));
    const heading = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    // Bank into a gentle hyzer, then flatten out as the disc slows into the chains.
    const bank = heading * 0.28 - 10 * Math.sin(t * Math.PI);
    const scale = 1 - 0.3 * t;
    disc.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${bank.toFixed(1)}) scale(${scale.toFixed(3)})`);
    trail.style.strokeDashoffset = `${(len * (1 - t)).toFixed(1)}`;
  };

  const burst = () => {
    sparks.replaceChildren();
    for (let i = 0; i < 18; i++) {
      const c = document.createElementNS(SVGNS, 'circle');
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
      const d = 40 + Math.random() * 50;
      c.setAttribute('cx', '1000');
      c.setAttribute('cy', '350');
      c.setAttribute('r', (1.5 + Math.random() * 2.5).toFixed(1));
      c.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(1)}px`);
      c.style.setProperty('--dy', `${(Math.sin(a) * d * 0.8).toFixed(1)}px`);
      c.style.animationDelay = `${Math.random() * 80}ms`;
      c.setAttribute('class', i % 3 ? 'spark' : 'spark alt');
      sparks.append(c);
    }
  };

  const land = () => {
    hero.classList.add('landed');
    basket.classList.remove('hit');
    ching.classList.remove('show');
    // Force a reflow so the CSS animations restart on repeat throws.
    void basket.getBoundingClientRect();
    basket.classList.add('hit');
    ching.classList.add('show');
    burst();
    timer = setTimeout(() => trail.classList.add('fade'), 900);
  };

  function throwDisc() {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    hero.classList.remove('landed');
    hero.classList.add('thrown');
    trail.classList.remove('fade');
    if (reduceMotion.matches) {
      place(1);
      land();
      return;
    }
    const duration = 1900;
    // Slight acceleration so the disc drives into the chains instead of drifting in.
    const ease = (x) => 0.8 * x + 0.2 * x * x;
    let t0;
    const step = (ts) => {
      t0 ??= ts;
      const x = Math.min(1, (ts - t0) / duration);
      place(ease(x));
      if (x < 1) raf = requestAnimationFrame(step);
      else land();
    };
    place(0);
    raf = requestAnimationFrame(step);
  }

  if (!reduceMotion.matches && matchMedia('(pointer: fine)').matches) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--px', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      hero.style.setProperty('--py', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
  }

  document.getElementById('rethrow')?.addEventListener('click', throwDisc);
  setTimeout(throwDisc, 500);
  return { throwDisc };
}

function makeStars(g) {
  if (!g) return;
  for (let i = 0; i < 70; i++) {
    const s = document.createElementNS(SVGNS, 'circle');
    s.setAttribute('cx', (Math.random() * 1200).toFixed(0));
    s.setAttribute('cy', (Math.random() * 330).toFixed(0));
    s.setAttribute('r', (Math.random() * 1.3 + 0.3).toFixed(2));
    s.setAttribute('class', 'star');
    s.style.animationDelay = `${(Math.random() * 6).toFixed(2)}s`;
    s.style.animationDuration = `${(3 + Math.random() * 4).toFixed(2)}s`;
    g.append(s);
  }
}
