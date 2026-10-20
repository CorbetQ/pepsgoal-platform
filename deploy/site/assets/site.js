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
    // Menu fermé : inerte, donc hors de la navigation au clavier ; à la fermeture, le focus revient au bouton du menu
    let opener = null;
    drawer.inert = true;
    const open = on => {
      drawer.classList.toggle('open', on); drawer.setAttribute('aria-hidden', String(!on)); drawer.inert = !on;
      document.body.style.overflow = on ? 'hidden' : '';
      if (on) drawer.querySelector('a,button')?.focus(); else opener?.focus();
    };
    document.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', () => { opener = b; open(true); }));
    // Revenu à une largeur de bureau, le menu se referme seul
    matchMedia('(min-width: 1061px)').addEventListener('change', e => { if (e.matches && drawer.classList.contains('open')) open(false); });
    drawer.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => open(false)));
    drawer.addEventListener('click', e => { if (e.target === drawer) open(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('open')) open(false); });
  }

  /* ---------- en-tête toujours visible (état « défilé » avec hystérésis), barre de lecture ---------- */
  const header = document.querySelector('.site-h'), bar = document.querySelector('.progress');
  let ticking = false, scrolled = false;
  const onScroll = () => {
    const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.setProperty('--p', h > 0 ? Math.min(1, y / h).toFixed(4) : 0);
    // seuils distincts à l'aller et au retour : pas de bascule répétée autour d'une même position
    if (header && (scrolled ? y < 8 : y > 24)) { scrolled = !scrolled; header.classList.toggle('scrolled', scrolled); }
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive:true });

  /* ---------- halos : dérive lente + parallaxe ---------- */
  const blobs = [...document.querySelectorAll('.blob')];
  const drift = [[.9, 1.3, 40], [1.2, .8, 55], [.7, 1.1, 48], [1.5, 1.2, 30]];
  let t0 = performance.now(), px = 0, py = 0;
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

  /* ---------- sommaire des documents légaux : section visible surlignée ---------- */
  document.querySelectorAll('.doc-toc').forEach(toc => {
    const links = [...toc.querySelectorAll('a')];
    const spy = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      links.forEach(l => {
        const on = l.getAttribute('href') === `#${e.target.id}`;
        l.classList.toggle('on', on);
        if (on && getComputedStyle(toc).flexDirection === 'row') toc.scrollTo({ left:l.offsetLeft - 24, behavior:'smooth' });
      });
    }), { rootMargin:'-40% 0px -55% 0px' });
    links.forEach(l => { const t = document.querySelector(l.getAttribute('href')); if (t) spy.observe(t); });
  });

  /* ---------- année du pied de page ---------- */
  document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
  onScroll();
})();

/* ---------- démonstrations 1.3.0 : sondages et sélecteur d'emojis ---------- */
(() => {
  // Sondage : voter révèle les résultats ; un second clic retire le vote
  document.querySelectorAll('[data-poll]').forEach(poll => {
    const opts = [...poll.querySelectorAll('.poll-opt')], meta = poll.querySelector('.poll-meta'), multi = poll.dataset.poll === 'multi';
    const base = opts.map(o => parseInt(o.dataset.n, 10) || 0), voters = parseInt(poll.dataset.voters, 10) || 0;
    const render = () => {
      const mine = opts.map(o => o.classList.contains('on')), voted = mine.some(Boolean);
      const counts = base.map((n, i) => n + (mine[i] ? 1 : 0)), total = voters + (voted ? 1 : 0), top = Math.max(...counts);
      poll.classList.toggle('res', voted);
      opts.forEach((o, i) => {
        const pct = total ? Math.round(counts[i] / total * 100) : 0;
        o.style.setProperty('--pct', voted ? `${pct}%` : '0%');
        o.classList.toggle('lead', voted && counts[i] === top);
        o.querySelector('.po-n').textContent = `${pct} %`;
        o.setAttribute('aria-pressed', String(mine[i]));
      });
      if (meta) meta.textContent = `${total} votant${total > 1 ? 's' : ''} · ${multi ? 'plusieurs réponses' : 'une réponse'} · ${voted ? 'merci pour ton vote' : 'vote pour voir les résultats'}`;
    };
    poll.addEventListener('click', e => {
      const o = e.target.closest('.poll-opt'); if (!o) return;
      const on = !o.classList.contains('on');
      if (!multi) opts.forEach(x => x.classList.remove('on'));
      o.classList.toggle('on', on);
      if (on) { const r = o.getBoundingClientRect(); window.pgSparks?.(r.right - 24, r.top + r.height / 2, null, 10); }
      render();
    });
    render();
  });
  // Sélecteur d'emojis : onglets de catégories (flèches gauche/droite au clavier) et choix d'un emoji
  document.querySelectorAll('[data-ep]').forEach(ep => {
    const tabs = [...ep.querySelectorAll('.ep-cat')], target = document.querySelector(ep.dataset.target || '[data-ep-target]');
    const select = t => {
      tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; document.getElementById(x.getAttribute('aria-controls')).hidden = !on; });
    };
    ep.addEventListener('click', e => {
      const t = e.target.closest('.ep-cat'); if (t) { select(t); return; }
      const b = e.target.closest('.ep-e'); if (!b) return;
      ep.querySelectorAll('.ep-e').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      if (target) target.innerHTML = b.innerHTML;
    });
    ep.addEventListener('keydown', e => {
      const i = tabs.indexOf(document.activeElement); if (i < 0 || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const t = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; select(t); t.focus(); e.preventDefault();
    });
  });
})();

/* ---------- démonstrations 2.0.0 : réactions, arrière-plans, favoris, étapes, suggestions, monochrome ---------- */
(() => {
  const root = document.documentElement;
  const store = { get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch(e){} } };
  // Arrière-plan choisi : gardé pour tout le site, sur cet appareil
  const BGS = ['blob', 'aurora', 'waves', 'stars', 'mesh', 'grid', 'plain'];
  const setBg = bg => { if (!BGS.includes(bg)) bg = 'blob'; root.dataset.bg = bg; document.querySelectorAll('.bg-seg [data-bg]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bg === bg))); };
  setBg(store.get('pepsgoal.site.bg') || 'blob');
  document.addEventListener('click', e => { const b = e.target.closest('.bg-seg [data-bg]'); if (!b) return; setBg(b.dataset.bg); store.set('pepsgoal.site.bg', b.dataset.bg); });

  // Réactions : toucher une réaction l'ajoute ou la retire sous le message
  document.querySelectorAll('.rx-bar').forEach(bar => {
    const target = bar.closest('.card')?.querySelector('[data-rx-target] .rx-chips'); if (!target) return;
    const base = {};
    target.querySelectorAll('.rx-chip').forEach(c => { base[c.querySelector('img').src.split('/').pop().replace('.webp', '')] = parseInt(c.textContent, 10) || 1; });
    const mine = new Set();
    const render = () => {
      const keys = [...new Set([...Object.keys(base), ...mine])];
      target.innerHTML = keys.map(k => { const n = (base[k] || 0) + (mine.has(k) ? 1 : 0); return `<span class="rx-chip${mine.has(k) ? ' mine' : ''}"><img src="emoji/${k}.webp" alt=""> ${n}</span>`; }).join('');
    };
    bar.addEventListener('click', e => {
      const b = e.target.closest('.rx-btn'); if (!b) return;
      const k = b.dataset.rx, on = !mine.has(k);
      on ? mine.add(k) : mine.delete(k); b.setAttribute('aria-pressed', String(on)); render();
      if (on) { const r = b.getBoundingClientRect(); window.pgSparks?.(r.left + r.width / 2, r.top + r.height / 2, null, 10); }
    });
  });

  // Favori
  document.addEventListener('click', e => { const b = e.target.closest('.fav-btn'); if (!b) return; const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); b.querySelector('span').textContent = on ? 'Favori' : 'Ajouter aux favoris'; });

  // Étapes de projet : flèches (clavier) et glisser-déposer
  document.querySelectorAll('.steps-list').forEach(list => {
    const flash = li => { li.classList.remove('moved'); void li.offsetWidth; li.classList.add('moved'); };
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-mv]'); if (!b) return;
      const li = b.closest('li'), dir = +b.dataset.mv, sib = dir < 0 ? li.previousElementSibling : li.nextElementSibling; if (!sib) return;
      dir < 0 ? list.insertBefore(li, sib) : list.insertBefore(sib, li);
      flash(li); b.focus();
    });
    let dragged = null;
    list.addEventListener('dragstart', e => { dragged = e.target.closest('li'); dragged?.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
    list.addEventListener('dragend', () => { dragged?.classList.remove('drag'); if (dragged) flash(dragged); dragged = null; });
    list.addEventListener('dragover', e => {
      e.preventDefault(); const over = e.target.closest('li'); if (!dragged || !over || over === dragged) return;
      const r = over.getBoundingClientRect(); list.insertBefore(dragged, e.clientY > r.top + r.height / 2 ? over.nextElementSibling : over);
    });
  });

  // Suggestions d'amis : ajouter ou masquer
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-sug]'); if (!b) return;
    const li = b.closest('li');
    if (b.dataset.sug === 'add') { b.textContent = 'Envoyée'; b.classList.add('done'); b.disabled = true; }
    else { li.classList.add('gone'); setTimeout(() => li.remove(), 320); }
  });

  // Mode monochrome : interrupteurs synchronisés, effet sur toute la page (non mémorisé)
  const monos = [...document.querySelectorAll('#mono-demo, [data-mono-switch]')];
  monos.forEach(m => m.addEventListener('change', () => { const on = m.checked; monos.forEach(x => { x.checked = on; }); on ? root.setAttribute('data-mono', '') : root.removeAttribute('data-mono'); }));
})();

/* ---------------- Nouveautés 2.1 : ciel du thème Météo, période, partage, verre givré, onglets ---------------- */
(() => {
  const root = document.documentElement, reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // Ciel du thème Météo : un seul canevas, 30 images par seconde au plus, en pause hors de l'écran ou onglet caché,
  // image fixe si les animations sont réduites
  const SKIES = {
    dawn: { g: ['#3B3F8F', '#C77BB0', '#FFB38A'], body: 'sun', by: .8, clouds: 3, cc: '#FFD9CC', label: 'Aube · Dégagé' },
    day: { g: ['#2F8FE8', '#7EC8F5', '#D4EEFF'], body: 'sun', by: .24, clouds: 4, cc: '#FFFFFF', label: 'Jour · Ensoleillé' },
    dusk: { g: ['#2A2462', '#B4508A', '#FF9A5A'], body: 'sun', by: .84, clouds: 3, cc: '#FFB8A0', label: 'Crépuscule · Peu nuageux' },
    night: { g: ['#060B26', '#141B4A', '#2B2F6E'], body: 'moon', by: .22, clouds: 2, cc: '#3A4078', stars: true, label: 'Nuit · Étoilée' },
    rain: { g: ['#4B5D73', '#7D8FA3', '#A9B6C4'], clouds: 7, cc: '#8E9AAA', rain: 1, label: 'Jour · Pluie' },
    snow: { g: ['#8C99AB', '#B8C3D0', '#DDE3EA'], clouds: 6, cc: '#EEF1F5', snow: true, label: 'Jour · Neige' },
    storm: { g: ['#1A1F2D', '#2F374A', '#4A5469'], clouds: 8, cc: '#434C61', rain: 1.7, bolt: true, label: 'Soir · Orage' },
    fog: { g: ['#A7B0BA', '#C4CBD2', '#DFE3E7'], body: 'sun', by: .3, veil: true, clouds: 2, cc: '#F1F3F5', fog: true, label: 'Matin · Brouillard' }
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  document.querySelectorAll('[data-sky]').forEach(box => {
    const cv = box.querySelector('canvas'), ctx = cv.getContext('2d'), label = box.querySelector('[data-sky-label]');
    let W = 0, H = 0, sky, clouds = [], drops = [], stars = [], shoot = null, flash = 0, bolt = null, raf = 0, last = 0, visible = true;
    const setup = () => {
      clouds = Array.from({ length: sky.clouds }, (_, i) => { const d = i % 3; return { x: rnd(-.2, 1), y: rnd(.06, .5), s: [.55, .8, 1.1][d], v: [.006, .011, .02][d], d, puffs: [[-.75, .12, .42], [-.3, -.12, .58], [.2, -.22, .66], [.62, 0, .5], [0, .18, .5]].map(([x, y, s]) => [x + rnd(-.08, .08), y + rnd(-.05, .05), s * rnd(.9, 1.1)]) }; }).sort((a, b) => a.d - b.d);
      const n = sky.rain ? Math.round(90 * sky.rain) : sky.snow ? 70 : 0;
      drops = Array.from({ length: n }, () => ({ x: Math.random(), y: Math.random(), v: sky.snow ? rnd(.04, .09) : rnd(.9, 1.4), r: rnd(1, 2.6), p: rnd(0, 6.28) }));
      stars = sky.stars ? Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random() * .7, r: rnd(.4, 1.4), p: rnd(0, 6.28) })) : [];
      shoot = null; flash = 0; bolt = null;
    };
    const cloud = (c, t) => {
      const x = ((c.x + c.v * t) % 1.4 + 1.4) % 1.4 - .2, cx = x * W, cy = c.y * H, r = Math.min(W, H) * .16 * c.s;
      ctx.globalAlpha = [.55, .75, .95][c.d];
      for (const [dx, dy, s] of c.puffs) {
        const px = cx + dx * r * 1.3, py = cy + dy * r, pr = r * s * 1.25;
        const g = ctx.createRadialGradient(px - pr * .3, py - pr * .45, pr * .1, px, py, pr);
        g.addColorStop(0, '#fff'); g.addColorStop(.7, sky.cc); g.addColorStop(1, sky.cc + '00');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const draw = t => {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      sky.g.forEach((c, i) => bg.addColorStop(i / 2, c)); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      for (const s of stars) { ctx.globalAlpha = .45 + .55 * Math.abs(Math.sin(t * 1.6 + s.p)); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (sky.stars && !reduce.matches) {
        if (!shoot && Math.random() < .006) shoot = { x: rnd(.2, .9), y: rnd(.05, .3), t };
        if (shoot) {
          const k = (t - shoot.t) / .9, x = (shoot.x - k * .35) * W, y = (shoot.y + k * .18) * H, g = ctx.createLinearGradient(x, y, x + 60, y - 30);
          g.addColorStop(0, `rgba(255,255,255,${1 - k})`); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60, y - 30); ctx.stroke();
          if (k >= 1) shoot = null;
        }
      }
      if (sky.body) {
        const bx = W * .74, by = H * sky.by, r = Math.min(W, H) * .11, moon = sky.body === 'moon';
        const halo = ctx.createRadialGradient(bx, by, r * .6, bx, by, r * (moon ? 3 : 4.2 + Math.sin(t * 1.2) * .3));
        halo.addColorStop(0, moon ? 'rgba(230,236,255,.45)' : sky.veil ? 'rgba(255,255,255,.5)' : 'rgba(255,236,160,.75)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(bx, by, r * 4.6, 0, 7); ctx.fill();
        if (!moon && !sky.veil) {
          ctx.save(); ctx.translate(bx, by); ctx.rotate(t * .08); ctx.strokeStyle = 'rgba(255,240,180,.35)'; ctx.lineWidth = 3;
          for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(r * 1.35, 0); ctx.lineTo(r * 1.9, 0); ctx.stroke(); }
          ctx.restore();
        }
        ctx.fillStyle = moon ? '#EEF1FF' : sky.veil ? 'rgba(255,255,250,.85)' : '#FFE27A'; ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.fill();
        if (moon) { ctx.fillStyle = 'rgba(160,170,210,.45)'; [[-.35, -.2, .22], [.3, .25, .16], [.1, -.45, .1], [-.1, .4, .12]].forEach(([dx, dy, s]) => { ctx.beginPath(); ctx.arc(bx + dx * r, by + dy * r, s * r, 0, 7); ctx.fill(); }); }
      }
      for (const c of clouds) cloud(c, reduce.matches ? 0 : t);
      if (sky.rain) {
        ctx.strokeStyle = 'rgba(220,232,255,.55)'; ctx.lineWidth = 1.2; ctx.beginPath();
        for (const d of drops) { const y = ((d.y + d.v * t) % 1) * H, x = d.x * W - y * .12; ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 13); }
        ctx.stroke();
      }
      if (sky.snow) {
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        for (const d of drops) { const y = ((d.y + d.v * t) % 1) * H, x = d.x * W + Math.sin(t * 1.3 + d.p) * 10; ctx.beginPath(); ctx.arc(x, y, d.r, 0, 7); ctx.fill(); }
      }
      if (sky.fog) for (let i = 0; i < 4; i++) {
        const y = H * (.35 + i * .17), x = Math.sin(t * .15 + i) * W * .1, g = ctx.createLinearGradient(0, y - 30, 0, y + 30);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x - W * .2, y - 30, W * 1.4, 60);
      }
      if (sky.bolt && !reduce.matches) {
        if (!bolt && Math.random() < .012) { let x = rnd(.2, .8) * W, y = 0; const pts = [[x, y]]; while (y < H * .7) { x += rnd(-22, 22); y += rnd(14, 26); pts.push([x, y]); } bolt = { pts, t }; flash = 1; }
        if (bolt) {
          const k = (t - bolt.t) / .35; ctx.strokeStyle = `rgba(255,255,230,${Math.max(0, 1 - k)})`; ctx.lineWidth = 2.5; ctx.beginPath();
          bolt.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); if (k >= 1) bolt = null;
        }
        if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * .35})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - .12); }
      }
    };
    const loop = now => {
      raf = 0; if (!visible || document.hidden || reduce.matches) return;
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return; last = now; draw(now / 1000);
    };
    const run = () => { if (reduce.matches) { draw(2); return; } if (!raf) raf = requestAnimationFrame(loop); };
    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1), r = cv.getBoundingClientRect(); W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(performance.now() / 1000); run();
    };
    const set = k => { sky = SKIES[k] || SKIES.day; box.dataset.sky = k; if (label) label.textContent = sky.label; setup(); if (W) { draw(performance.now() / 1000); run(); } };
    set(box.dataset.sky);
    new ResizeObserver(resize).observe(cv);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) run(); }).observe(box);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
    reduce.addEventListener?.('change', run);
    const seg = box.parentElement.querySelector('.sky-seg');
    seg?.addEventListener('click', e => {
      const b = e.target.closest('[data-sky-set]'); if (!b) return;
      seg.querySelectorAll('[data-sky-set]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); set(b.dataset.skySet);
    });
  });

  // Objectif Période : jours choisis et résumé
  document.querySelectorAll('.days').forEach(g => {
    const sum = g.parentElement.querySelector('[data-days-sum]');
    g.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      const on = [...g.querySelectorAll('[aria-pressed="true"]')].map(x => x.getAttribute('aria-label').toLowerCase());
      const list = on.length > 1 ? `${on.slice(0, -1).join(', ')} et ${on.at(-1)}` : on[0];
      if (sum) sum.textContent = on.length ? `${list[0].toUpperCase()}${list.slice(1)} · validation jusqu’à 20 h` : 'Choisis au moins un jour';
    });
  });

  // Panneau de partage
  const SHARE = { 'so-feed': 'Publié dans le Feed de tes amis.', 'so-story': 'Ajouté à ta story pour 24 h.', 'so-msg': 'Choisis un ami ou un groupe : le message part chiffré.', 'so-ext': 'Texte copié, prêt à coller dans une autre application.' };
  document.querySelectorAll('[data-share]').forEach(list => {
    const out = list.parentElement.querySelector('.share-out');
    list.addEventListener('click', e => {
      const b = e.target.closest('.so'); if (!b) return;
      list.querySelectorAll('.so').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      if (out) out.textContent = SHARE[[...b.classList].find(c => c in SHARE)];
      const r = b.getBoundingClientRect(); window.pgSparks?.(r.left + 26, r.top + r.height / 2, null, 10);
    });
  });

  // Flou du verre givré : s'applique aux panneaux de toute la page (non mémorisé)
  document.querySelectorAll('.blur-seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('[data-blur]'); if (!b) return;
    document.querySelectorAll('.blur-seg [data-blur]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.blur === b.dataset.blur)));
    b.dataset.blur === 'mid' ? root.removeAttribute('data-blur') : root.setAttribute('data-blur', b.dataset.blur);
  }));

  // Onglets : le fond de l'onglet sélectionné glisse d'un onglet à l'autre
  document.querySelectorAll('.glide').forEach(g => {
    const ind = g.querySelector('.glide-ind');
    const place = (anim = true) => {
      const b = g.querySelector('[aria-pressed="true"]'); if (!b) return;
      if (!anim) ind.style.transition = 'none';
      Object.assign(ind.style, { width: `${b.offsetWidth}px`, height: `${b.offsetHeight}px`, transform: `translate(${b.offsetLeft}px,${b.offsetTop}px)` });
      if (!anim) { ind.offsetWidth; ind.style.transition = ''; }
    };
    g.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); place();
    });
    new ResizeObserver(() => place(false)).observe(g);
  });
})();
