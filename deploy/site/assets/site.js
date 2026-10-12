/* PepsGoal — site vitrine : comportements communs à toutes les pages. Aucun traceur, aucun service tiers. */
(() => {
  const root = document.documentElement;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
    set(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
  };

  /* ---------- thème clair / sombre ---------- */
  const saved = store.get('pepsgoal.site.theme');
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.querySelectorAll('[data-theme-toggle]').forEach(b => {
    const label = () => b.setAttribute('aria-label', isDark() ? 'Passer en thème clair' : 'Passer en thème sombre');
    label();
    b.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      const go = () => { root.dataset.theme = next; store.set('pepsgoal.site.theme', next); label(); };
      if (document.startViewTransition && !reduced()) document.startViewTransition(go); else go();
    });
  });

  /* ---------- menu mobile ---------- */
  const drawer = document.querySelector('.drawer');
  if (drawer) {
    const open = on => { drawer.classList.toggle('open', on); drawer.setAttribute('aria-hidden', String(!on)); document.body.style.overflow = on ? 'hidden' : ''; if (on) drawer.querySelector('a,button')?.focus(); };
    document.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', () => open(true)));
    drawer.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => open(false)));
    drawer.addEventListener('click', e => { if (e.target === drawer) open(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('open')) open(false); });
  }

  /* ---------- en-tête masqué en descendant, barre de lecture ---------- */
  const header = document.querySelector('.site-h'), bar = document.querySelector('.progress');
  let lastY = scrollY, ticking = false;
  const onScroll = () => {
    const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.setProperty('--p', h > 0 ? (y / h).toFixed(4) : 0);
    if (header) header.classList.toggle('hide', y > 240 && y > lastY + 4 && !document.activeElement?.closest('.site-h'));
    if (y < lastY - 4 || y < 240) header?.classList.remove('hide');
    lastY = y; ticking = false;
    parallax();
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive:true });

  /* ---------- halos : dérive lente + parallaxe ---------- */
  const blobs = [...document.querySelectorAll('.blob')];
  const drift = [[.9, 1.3, 40], [1.2, .8, 55], [.7, 1.1, 48], [1.5, 1.2, 30]];
  let t0 = performance.now(), px = 0, py = 0;
  function parallax(){}
  if (blobs.length && !reduced()) {
    const frame = now => {
      const t = (now - t0) / 1000, s = scrollY;
      blobs.forEach((b, i) => {
        const [fx, fy, amp] = drift[i % drift.length];
        const x = Math.sin(t * .12 * fx + i) * amp + px * (i + 1) * 6;
        const y = Math.cos(t * .1 * fy + i * 2) * amp - s * (.04 + i * .025) + py * (i + 1) * 6;
        b.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${(1 + Math.sin(t * .2 + i) * .06).toFixed(3)})`;
      });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ---------- lueur qui suit le pointeur ---------- */
  const glow = document.querySelector('.glow');
  if (glow && matchMedia('(pointer: fine)').matches && !reduced()) {
    let gx = innerWidth / 2, gy = innerHeight / 3, tx = gx, ty = gy;
    addEventListener('pointermove', e => {
      tx = e.clientX; ty = e.clientY; document.body.classList.add('has-pointer');
      px = (e.clientX / innerWidth - .5); py = (e.clientY / innerHeight - .5);
    }, { passive:true });
    document.addEventListener('pointerleave', () => document.body.classList.remove('has-pointer'));
    const loop = () => { gx += (tx - gx) * .12; gy += (ty - gy) * .12; glow.style.transform = `translate3d(${gx}px,${gy}px,0)`; requestAnimationFrame(loop); };
    loop();
  }

  /* ---------- titres découpés lettre par lettre ---------- */
  document.querySelectorAll('[data-split]').forEach(el => {
    let i = 0;
    const walk = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(word => {
            if (!word) return;
            if (/^\s+$/.test(word)) { frag.append(' '); return; }
            const w = document.createElement('span'); w.className = 'w';
            [...word].forEach(c => { const s = document.createElement('span'); s.className = 'ch'; s.style.setProperty('--i', i++); s.textContent = c; w.append(s); });
            frag.append(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && !n.matches('svg')) walk(n);
      });
    };
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    walk(el);
    el.querySelectorAll('.w').forEach(w => w.setAttribute('aria-hidden', 'true'));
    el.classList.add('split');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  });

  /* ---------- apparitions au défilement, compteurs, anneaux ---------- */
  const count = el => {
    const end = parseFloat(el.dataset.count), dec = (el.dataset.count.split('.')[1] || '').length, dur = 1400, start = performance.now();
    const fmt = v => v.toLocaleString('fr-FR', { minimumFractionDigits:dec, maximumFractionDigits:dec });
    if (reduced()) { el.textContent = fmt(end); return; }
    const step = now => { const k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(end * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    const el = en.target; el.classList.add('in'); io.unobserve(el);
    el.querySelectorAll('[data-count]').forEach(count);
    if (el.matches('[data-count]')) count(el);
    el.querySelectorAll('.ring .val[data-v]').forEach(r => r.style.strokeDashoffset = (1 - r.dataset.v) * r.getTotalLength());
  }), { threshold:.15, rootMargin:'0px 0px -8% 0px' });
  document.querySelectorAll('.ring .val[data-v]').forEach(r => { const L = r.getTotalLength(); r.style.strokeDasharray = L; r.style.strokeDashoffset = L; });
  document.querySelectorAll('.rv, [data-count]:not(.rv [data-count])').forEach(el => io.observe(el));

  /* ---------- cartes inclinables + boutons aimantés ---------- */
  if (matchMedia('(pointer: fine)').matches && !reduced()) {
    document.querySelectorAll('.tilt').forEach(el => {
      const max = parseFloat(el.dataset.tilt || 8);
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.style.transform = `perspective(900px) rotateX(${((.5 - y) * max).toFixed(2)}deg) rotateY(${((x - .5) * max).toFixed(2)}deg) translateY(-4px)`;
        el.style.setProperty('--mx', `${x * 100}%`); el.style.setProperty('--my', `${y * 100}%`);
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
    document.querySelectorAll('[data-magnet]').forEach(el => {
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        el.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * .18).toFixed(1)}px,${((e.clientY - r.top - r.height / 2) * .28).toFixed(1)}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ---------- étincelles de validation ---------- */
  const COLORS = ['var(--flame-2)', 'var(--flame)', 'var(--pink)', 'var(--t-goal)', 'var(--t-routine)'];
  window.pgSparks = (x, y, label, n = 18) => {
    if (label) { const p = document.createElement('span'); p.className = 'plus'; p.textContent = label; p.style.left = `${x}px`; p.style.top = `${y - 20}px`; document.body.append(p); setTimeout(() => p.remove(), 1000); }
    if (reduced()) return;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i'); s.className = 'spark';
      s.style.setProperty('--sc', COLORS[i % COLORS.length]); s.style.left = `${x - 4}px`; s.style.top = `${y - 4}px`;
      document.body.append(s);
      const a = (Math.PI * 2 * i) / n + Math.random() * .4, d = 40 + Math.random() * 50;
      s.animate([{ transform:'translate(0,0) scale(1)', opacity:1 }, { transform:`translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 20}px) scale(0)`, opacity:0 }],
        { duration:700 + Math.random() * 300, easing:'cubic-bezier(.2,.9,.3,1)' }).onfinish = () => s.remove();
    }
  };
  // Coches de démonstration : basculent, font jaillir des étincelles et un « +N »
  document.addEventListener('click', e => {
    const c = e.target.closest('.check[data-demo]'); if (!c) return;
    const on = !c.classList.contains('on');
    c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on));
    c.closest('.item')?.classList.toggle('done', on);
    c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
    if (on) { const r = c.getBoundingClientRect(); pgSparks(r.left + r.width / 2, r.top + r.height / 2, `+${c.dataset.pts || 10}`); }
    document.dispatchEvent(new CustomEvent('pg:check', { detail:{ on } }));
  });
  // Encourager
  document.addEventListener('click', e => {
    const c = e.target.closest('.cheer[data-demo]'); if (!c) return;
    const on = !c.classList.contains('on'), n = c.querySelector('[data-n]');
    c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on));
    if (n) n.textContent = String(parseInt(n.textContent, 10) + (on ? 1 : -1));
    if (on) { const r = c.getBoundingClientRect(); pgSparks(r.left + 20, r.top + r.height / 2, null, 12); }
  });
  // Boutons pressés (segmentés, filtres)
  document.querySelectorAll('[data-press-group]').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !g.contains(b)) return;
    g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));

  /* ---------- copier dans le presse-papiers ---------- */
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch(err) { return; }
    const live = document.getElementById('live');
    if (live) live.textContent = `Copié : ${b.dataset.copy}`;
    b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1200);
  });

  /* ---------- année du pied de page ---------- */
  document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
  onScroll();
})();
