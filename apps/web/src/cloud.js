/*
 * PepsGoal — couche « connectée ».
 *
 * L'interface est celle de l'application d'origine (apps/web-legacy/pepsgoal.html), sans changement de rendu.
 * Ce fichier, injecté avant elle par apps/web/build.mjs, la relie au serveur PepsGoal :
 *   - comptes (connexion, inscription, passage d'un profil sans compte à un compte) ;
 *   - synchronisation hors ligne des objectifs, validations et réglages : l'application écrit dans sa base locale,
 *     puis chaque différence avec le dernier état connu du serveur est envoyée dès que la connexion le permet ;
 *   - fonctions sociales (amis, feed, encouragements, commentaires, stories, notifications) lues depuis le serveur ;
 *   - messages privés chiffrés de bout en bout (même protocole que docs/E2E.md, avec tweetnacl) ;
 *   - modération (comptes, publications, contestations, maintenances, annonces).
 * Sans compte et en mode démonstration, l'application reste 100 % locale, comme avant.
 */
(function () {
  'use strict';
  const CFG = window.PEPSGOAL_CONFIG;
  if (!CFG || !CFG.api) return;
  const API = String(CFG.api).replace(/\/$/, '');
  const ACCT_KEY = 'pepsgoal.account.v1', TOK_KEY = 'pepsgoal.tokens.v1', DEV_KEY = 'pepsgoal.e2e.v1';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SOCIAL_TYPES = ['group', 'duel'];
  const S = {
    acct: false, tokens: null, serverOk: navigator.onLine !== false, navOnline: navigator.onLine !== false, pulledOnce: false,
    syncing: null, lastSync: null, syncError: '', refreshing: null, failures: 0, pingTimer: null,
    search: { q: null, list: [], busy: false }, viewed: new Set(), profileLoaded: new Map()
  };
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage plein ou indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignoré */ } }
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16; return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }));
  const isoOf = ms => (ms == null || ms === '' || !Number.isFinite(Number(ms)) ? null : new Date(Number(ms)).toISOString());
  const msOf = iso => (iso ? Date.parse(iso) : null);
  const meId = () => DB.session;

  /* =========================================================================================
   * Réseau : le serveur doit répondre, sinon l'application passe hors ligne et réessaie
   * ========================================================================================= */
  const RETRY = [5000, 10000, 20000, 40000, 60000];
  let maintenanceStatus = null;
  function setOnline(v) {
    const was = NET.online;
    S.serverOk = v;
    if (was !== NET.online) { const e = new Event(NET.online ? 'online' : 'offline'); e.pg = true; window.dispatchEvent(e); if (NET.online) onReconnect(); }
  }
  async function ping() {
    clearTimeout(S.pingTimer);
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(API + '/v1/status', { signal: ctrl.signal, cache: 'no-store' });
      const s = await r.json();
      if (!r.ok || !s.ok) throw new Error('indisponible');
      S.failures = 0; maintenanceStatus = s.maintenance || null; applyMaintenanceStatus();
      setOnline(true);
      S.pingTimer = setTimeout(ping, 60000);
    } catch (e) {
      setOnline(false);
      S.pingTimer = setTimeout(ping, RETRY[Math.min(S.failures++, RETRY.length - 1)]);
    } finally { clearTimeout(t); }
  }
  function serverDown() { if (S.serverOk) { setOnline(false); S.failures = 0; S.pingTimer = setTimeout(ping, RETRY[0]); } }
  function onReconnect() { if (S.acct) { void syncNow(); void refreshSocial(); } }

  /* =========================================================================================
   * API : jetons d'accès (15 min) renouvelés automatiquement avec le jeton de renouvellement
   * ========================================================================================= */
  class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
  let refreshing = null;
  async function refreshTokens() {
    refreshing = refreshing || (async () => {
      const t = S.tokens; if (!t?.refreshToken) return false;
      try {
        const r = await fetch(API + '/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) });
        if (r.status === 401) { sessionLost(); return false; }
        if (!r.ok) return false;
        const d = await r.json();
        S.tokens = { accessToken: d.accessToken, refreshToken: d.refreshToken }; ls.set(TOK_KEY, S.tokens);
        return true;
      } catch (e) { return false; } finally { setTimeout(() => { refreshing = null; }, 0); }
    })();
    return refreshing;
  }
  async function api(method, path, body, retry = true) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
      const isForm = body instanceof FormData;
      res = await fetch(API + path, {
        method, signal: ctrl.signal,
        headers: Object.assign(isForm ? {} : { 'content-type': 'application/json' }, S.tokens?.accessToken ? { authorization: 'Bearer ' + S.tokens.accessToken } : {}),
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body)
      });
    } catch (e) { serverDown(); throw new ApiError(0, 'offline', 'Connexion impossible au serveur PepsGoal.'); }
    finally { clearTimeout(timer); }
    if ((res.status === 502 || res.status === 504)) serverDown();
    if (res.status === 401 && retry && S.tokens && (await refreshTokens())) return api(method, path, body, false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || 'error', data.message || 'Erreur inattendue, réessaie dans un instant.');
    return data;
  }
  const fail = e => toast(e?.message || 'Action impossible pour le moment.', 'x');
  function sessionLost() {
    if (!S.acct) return;
    toast('Ta session a expiré : reconnecte-toi.', 'lock');
    leaveAccount(false);
  }

  /* =========================================================================================
   * Conversion entre le modèle de l'application et celui du serveur (packages/shared)
   * ========================================================================================= */
  const TOP = new Set(['id', 'userId', 'type', 'title', 'icon', 'note', 'visibility', 'createdAt', 'archived', 'completedAt', 'failedAt', 'members', 'buddy', 'buddyVerify', 'buddyMiss']);
  const clampStr = (v, n, d = '') => (typeof v === 'string' ? v.slice(0, n) : d);
  const dayOk = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  function goalData(g) {
    const d = {};
    for (const k of Object.keys(g)) if (!TOP.has(k) && !k.startsWith('_') && g[k] !== undefined) d[k] = g[k];
    const num = (v, def) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : def);
    d.unit = clampStr(d.unit, 20);
    switch (g.type) {
      case 'routine': d.mode = d.mode === 'count' ? 'count' : 'days'; d.days = (d.days || []).map(Number).filter(n => n >= 0 && n <= 6); d.perWeek = Math.min(7, Math.max(1, Math.round(num(d.perWeek, 3)))); break;
      case 'objective': case 'monthly': case 'group': d.target = Math.max(0.0001, num(d.target, 1)); if (g.type !== 'monthly') d.endDate = dayOk(d.endDate) ? d.endDate : ''; if (g.type === 'monthly') d.cumulate = !!d.cumulate; break;
      case 'deadline': d.due = dayOk(d.due) ? d.due : today(); break;
      case 'abstinence': d.since = dayOk(d.since) ? d.since : today(); break;
      case 'limit': d.max = Math.max(0, num(d.max, 1)); d.period = d.period === 'week' ? 'week' : 'day'; break;
      case 'duration': d.minutes = Math.min(1440, Math.max(1, num(d.minutes, 30))); break;
      case 'measure': d.dir = d.dir === 'down' ? 'down' : 'up'; d.timeFmt = !!d.timeFmt; d.target = Number.isFinite(Number(d.target)) && d.target !== '' && d.target !== null ? Number(d.target) : null; break;
      case 'timed': d.mode = ['before', 'after', 'notafter'].includes(d.mode) ? d.mode : 'before'; d.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(d.time || '') ? d.time : '07:00'; d.days = (d.days || []).map(Number).filter(n => n >= 0 && n <= 6); break;
      case 'project': d.due = dayOk(d.due) ? d.due : ''; d.tasks = (d.tasks || []).slice(0, 200).map(t => ({ id: String(t.id).slice(0, 64) || uuid(), t: clampStr(t.t, 120), done: !!t.done })); break;
      case 'challenge': d.length = Math.min(365, Math.max(2, Math.round(num(d.length, 30)))); d.start = dayOk(d.start) ? d.start : today(); break;
      case 'program': d.base = Math.max(0.0001, num(d.base, 1)); d.step = num(d.step, 0); d.weeks = Math.min(52, Math.max(2, Math.round(num(d.weeks, 4)))); d.start = dayOk(d.start) ? d.start : today(); break;
      case 'duel': d.endDate = dayOk(d.endDate) ? d.endDate : today(); break;
    }
    return d;
  }
  function toServerGoal(g) {
    return {
      id: g.id, ownerId: g.userId, type: g.type, title: clampStr(g.title, 80, 'Objectif') || 'Objectif', icon: clampStr(g.icon, 16, '🎯') || '🎯', note: clampStr(g.note, 240),
      visibility: ['private', 'friends', 'public'].includes(g.visibility) ? g.visibility : 'friends', groupId: null, archived: !!g.archived,
      completedAt: isoOf(g.completedAt), failedAt: isoOf(g.failedAt), data: goalData(g),
      memberIds: SOCIAL_TYPES.includes(g.type) ? (g.members || []).filter(id => UUID_RE.test(id)) : [],
      buddyId: g.buddy && UUID_RE.test(g.buddy) ? g.buddy : null, buddyVerify: !!g.buddyVerify, buddyMiss: !!g.buddyMiss,
      createdAt: isoOf(g.createdAt) || new Date().toISOString()
    };
  }
  function fromServerGoal(sg) {
    const g = Object.assign({ milestones: [], monthsDone: [] }, sg.data || {}, {
      id: sg.id, userId: sg.ownerId, type: sg.type, title: sg.title, icon: sg.icon, note: sg.note || '', visibility: sg.visibility,
      createdAt: msOf(sg.createdAt) || Date.now(), archived: !!sg.archived, completedAt: msOf(sg.completedAt), failedAt: msOf(sg.failedAt),
      buddy: sg.buddyId || null, buddyVerify: !!sg.buddyVerify, buddyMiss: !!sg.buddyMiss
    });
    if (SOCIAL_TYPES.includes(sg.type)) g.members = (sg.memberIds && sg.memberIds.length ? sg.memberIds : [sg.ownerId]);
    if (g.days === undefined) g.days = [];
    if (g.perWeek === undefined) g.perWeek = 3;
    if (g.failedAt == null) delete g.failedAt;
    return g;
  }
  const toServerCheckin = c => ({
    id: c.id, goalId: c.goalId, userId: c.userId, date: c.date, kind: c.kind, value: Number(c.value) || 0,
    points: Math.max(0, Math.min(500, Math.round(c.pending ? (c.ptsPending || 0) : (c.pts || 0)))), pending: !!c.pending,
    taskId: c.taskId ? String(c.taskId).slice(0, 64) : null, createdAt: isoOf(c.at) || new Date().toISOString()
  });
  function fromServerCheckin(sc) {
    const c = { id: sc.id, goalId: sc.goalId, userId: sc.userId, date: sc.date, kind: sc.kind, value: sc.value, pts: sc.pending ? 0 : sc.points, at: msOf(sc.createdAt) || Date.now() };
    if (sc.pending) { c.pending = true; c.ptsPending = sc.points; }
    if (sc.taskId) c.taskId = sc.taskId;
    return c;
  }
  // État d'interface propre au compte, synchronisé avec les réglages
  const EXTRA_KEYS = ['tutorialDone', 'goalGroups', 'goalGroupOf', 'frozenDays', 'milestones', 'browser', 'defaultVis'];
  function toServerSettings(u) {
    const s = u.settings || {}, extra = {};
    for (const k of EXTRA_KEYS) { const v = k === 'browser' || k === 'defaultVis' ? s[k] : u[k]; if (v !== undefined) extra[k] = v; }
    return {
      theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system', accent: Math.min(31, Math.max(0, Number(s.accent) || 0)), social: s.social !== false,
      defaultVisibility: ['private', 'friends', 'public'].includes(s.defaultVis) ? s.defaultVis : 'friends',
      morning: { on: !!s.morning?.on, time: s.morning?.time || '08:30' }, evening: { on: !!s.evening?.on, time: s.evening?.time || '20:30' }, extra
    };
  }
  function applyServerSettings(u, st) {
    if (!st) return;
    Object.assign(u.settings, { theme: st.theme, accent: st.accent, social: st.social, morning: st.morning, evening: st.evening });
    const x = st.extra || {};
    if (x.browser !== undefined) u.settings.browser = x.browser;
    if (x.defaultVis !== undefined) u.settings.defaultVis = x.defaultVis;
    for (const k of ['tutorialDone', 'goalGroups', 'goalGroupOf', 'frozenDays', 'milestones']) if (x[k] !== undefined) u[k] = x[k];
  }
  // Utilisateur du serveur -> utilisateur de l'application
  function mapAvatar(a) {
    a = a || {};
    return { kind: a.kind || 'initials', color: Number(a.color) || 0, emoji: a.emoji || '😎', picto: a.picto || 'flameo', photo: a.photoUrl || '' };
  }
  function upsertUser(p, extra) {
    if (!p || !p.id) return null;
    let u = userById(p.id);
    if (!u) {
      const hue = Number(p.avatar?.color) || 0;
      u = Object.assign({ id: p.id, username: p.username, name: p.displayName, hue, bio: '', demo: false, passHash: null, salt: null, createdAt: Date.now(), settings: defSettings(), milestones: [] }, newUserFields(hue));
      DB.users.push(u);
    }
    u.username = p.username; u.name = p.displayName; u.avatar = mapAvatar(p.avatar); u._srv = true; delete u._stub;
    if (p.role === 'admin' || p.role === 'official') u.role = p.role; else delete u.role;
    if (p.role === 'official') { u.tutorialDone = true; u.avatar = { kind: 'picto', picto: 'flameo', color: 0, emoji: '', photo: '' }; }
    if (extra) Object.assign(u, extra);
    return u;
  }
  const banOf = m => (m && (m.banPermanent || (m.banUntil && Date.parse(m.banUntil) > Date.now())) ? { until: m.banPermanent ? null : Date.parse(m.banUntil), reason: m.banReason || '', at: Date.now() } : null);

  /* =========================================================================================
   * Base du compte : stockée à part de la base locale (profil sans compte, démonstration)
   * ========================================================================================= */
  function newAccountDB(user) {
    const db = { version: 8, users: [], friendships: [], goals: [], checkins: [], posts: [], notifs: [], session: user.id, reminderLog: {}, messages: [], appeals: [], reports: [], modlog: [], stories: [], news: [], timers: {}, _cloud: { cursor: 0, snap: { goals: {}, checkins: {}, settings: '' } } };
    return db;
  }
  // migrate() recrée un compte officiel local s'il n'y en a pas : seul celui du serveur doit rester
  function dropLocalOfficial() { DB.users = DB.users.filter(u => !(u.role === 'official' && !u._srv)); }
  // Les données du compte ont déjà été reçues au moins une fois sur cet appareil (hors ligne ensuite, tout reste utilisable)
  const pulledBefore = () => S.pulledOnce || !!(DB._cloud && DB._cloud.pulled);
  function cloudState() { DB._cloud = DB._cloud || { cursor: 0, snap: { goals: {}, checkins: {}, settings: '' } }; return DB._cloud; }
  function enterAccount(payload, db) {
    S.acct = true;
    S.tokens = { accessToken: payload.accessToken, refreshToken: payload.refreshToken }; ls.set(TOK_KEY, S.tokens);
    if (SANDBOX) { SANDBOX = false; ksReset(); }
    DB = db;
    // Le compte doit exister avant migrate() : sinon ses objectifs (repris du mode sans compte) passent pour orphelins et sont retirés
    upsertUser(payload.user);
    DB = migrate(DB); dropLocalOfficial(); // migrate() complète les champs de l'interface
    cloudState();
    const u = upsertUser(payload.user, { bio: payload.user.bio || '', freezes: payload.user.freezes || 0 });
    applyServerSettings(u, payload.user.settings);
    DB.session = u.id;
    save();
  }
  function leaveAccount(callServer) {
    const rt = S.tokens?.refreshToken, uid0 = meId();
    if (callServer && rt) void api('POST', '/v1/auth/logout', { refreshToken: rt }).catch(() => undefined);
    if (callServer && uid0) void e2eForget(true);
    S.acct = false; S.tokens = null; ls.del(TOK_KEY); ls.del(ACCT_KEY);
    E2E.cache.clear(); S.profileLoaded.clear();
    DB = migrate(load() || emptyDB()); DB.session = null;
    UI.modal = null; UI.view = 'today'; UI.renderedView = null; closeFs();
    render();
  }

  /* =========================================================================================
   * Synchronisation : différences avec le dernier état connu du serveur
   * ========================================================================================= */
  // Les identifiants anciens (profil sans compte, sauvegarde importée) deviennent des UUID avant l'envoi
  function normalizeIds() {
    const mine = meId(); let changed = false;
    const gmap = {};
    for (const g of DB.goals) if (g.userId === mine && !UUID_RE.test(g.id)) { gmap[g.id] = uuid(); }
    if (Object.keys(gmap).length) {
      changed = true;
      const u = me();
      for (const g of DB.goals) if (gmap[g.id]) g.id = gmap[g.id];
      for (const c of DB.checkins) if (gmap[c.goalId]) c.goalId = gmap[c.goalId];
      for (const p of DB.posts) if (gmap[p.goalId]) p.goalId = gmap[p.goalId];
      if (u?.goalGroupOf) for (const k of Object.keys(u.goalGroupOf)) if (gmap[k]) { u.goalGroupOf[gmap[k]] = u.goalGroupOf[k]; delete u.goalGroupOf[k]; }
      if (DB.timers?.[mine] && gmap[DB.timers[mine].goalId]) DB.timers[mine].goalId = gmap[DB.timers[mine].goalId];
    }
    for (const c of DB.checkins) if (c.userId === mine && !UUID_RE.test(c.id)) { c.id = uuid(); changed = true; }
    return changed;
  }
  const stableGoal = g => JSON.stringify(toServerGoal(g));
  const stableCheckin = c => JSON.stringify(toServerCheckin(c));
  function collectOps() {
    const mine = meId(), cs = cloudState(), snap = cs.snap, ops = [], marks = [];
    const now = new Date().toISOString();
    const own = DB.goals.filter(g => g.userId === mine), ownIds = new Set(own.map(g => g.id));
    for (const g of own) {
      const s = stableGoal(g);
      if (snap.goals[g.id] !== s) { ops.push({ opId: uuid(), entity: 'goal', action: 'upsert', id: g.id, data: Object.assign(JSON.parse(s), { updatedAt: now }), clientUpdatedAt: now }); marks.push(['goals', g.id, s]); }
    }
    for (const id of Object.keys(snap.goals)) if (!ownIds.has(id) && !DB.goals.some(g => g.id === id && g.userId !== mine)) {
      ops.push({ opId: uuid(), entity: 'goal', action: 'delete', id, clientUpdatedAt: now }); marks.push(['goals', id, null]);
    }
    const goalIds = new Set(DB.goals.map(g => g.id));
    const ownC = DB.checkins.filter(c => c.userId === mine && goalIds.has(c.goalId)), ownCIds = new Set(ownC.map(c => c.id));
    for (const c of ownC) {
      const s = stableCheckin(c);
      if (snap.checkins[c.id] !== s) { ops.push({ opId: uuid(), entity: 'checkin', action: 'upsert', id: c.id, data: Object.assign(JSON.parse(s), { updatedAt: now }), clientUpdatedAt: now }); marks.push(['checkins', c.id, s]); }
    }
    for (const id of Object.keys(snap.checkins)) if (!ownCIds.has(id)) { ops.push({ opId: uuid(), entity: 'checkin', action: 'delete', id, clientUpdatedAt: now }); marks.push(['checkins', id, null]); }
    const u = me();
    if (u) {
      const s = JSON.stringify(toServerSettings(u));
      if (snap.settings !== s) { ops.push({ opId: uuid(), entity: 'settings', action: 'upsert', id: 'settings', data: Object.assign(JSON.parse(s), { updatedAt: now }), clientUpdatedAt: now }); marks.push(['settings', null, s]); }
    }
    // Les objectifs passent avant leurs validations
    const order = { goal: 0, settings: 1, checkin: 2 };
    const idx = ops.map((o, i) => i).sort((a, b) => order[ops[a].entity] - order[ops[b].entity] || (ops[a].action === 'delete') - (ops[b].action === 'delete'));
    return { ops: idx.map(i => ops[i]), marks: idx.map(i => marks[i]) };
  }
  function pendingCount() { try { return S.acct ? collectOps().ops.length : 0; } catch (e) { return 0; } }
  function markSynced(mark) {
    const snap = cloudState().snap, [k, id, v] = mark;
    if (k === 'settings') snap.settings = v;
    else if (v == null) delete snap[k][id]; else snap[k][id] = v;
  }
  let syncTimer = null;
  function scheduleSync(ms = 1500) { if (!S.acct) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => void syncNow(), ms); }
  async function syncNow() {
    if (!S.acct || !NET.online) return;
    if (S.syncing) return S.syncing;
    S.syncing = (async () => {
      try {
        if (normalizeIds()) rawSave();
        const { ops, marks } = collectOps();
        for (let i = 0; i < ops.length; i += 100) {
          const batch = ops.slice(i, i + 100), bm = marks.slice(i, i + 100);
          const res = await api('POST', '/v1/sync/push', { deviceId: deviceId(), ops: batch });
          const rejected = new Map((res.rejected || []).map(r => [r.opId, r]));
          batch.forEach((op, j) => {
            // Refusé par le serveur (version plus récente ailleurs, données invalides) : la version du serveur fera foi au prochain tirage
            markSynced(bm[j]);
            if (rejected.has(op.opId) && rejected.get(op.opId).reason === 'invalid') console.warn('PepsGoal : modification refusée', op.entity, rejected.get(op.opId));
          });
          rawSave();
        }
        await pull();
        S.lastSync = Date.now(); S.syncError = '';
      } catch (e) { S.syncError = e.message || 'Erreur de synchronisation'; }
      finally { S.syncing = null; refreshSyncCard(); }
    })();
    return S.syncing;
  }
  async function pull() {
    const cs = cloudState();
    let changed = false;
    for (let guard = 0; guard < 50; guard++) {
      const r = await api('GET', '/v1/sync/pull?cursor=' + (cs.cursor || 0));
      const mine = meId();
      for (const sg of r.goals || []) {
        const g = fromServerGoal(sg), i = DB.goals.findIndex(x => x.id === g.id);
        ensureUserStub(g.userId); (g.members || []).forEach(ensureUserStub); if (g.buddy) ensureUserStub(g.buddy);
        if (i >= 0) { const keep = DB.goals[i]; for (const k of Object.keys(keep)) delete keep[k]; Object.assign(keep, g); } else DB.goals.push(g);
        if (g.userId === mine) cs.snap.goals[g.id] = stableGoal(g);
        changed = true;
      }
      for (const sc of r.checkins || []) {
        const c = fromServerCheckin(sc), i = DB.checkins.findIndex(x => x.id === c.id);
        ensureUserStub(c.userId);
        if (i >= 0) DB.checkins[i] = c; else DB.checkins.push(c);
        if (c.userId === mine) cs.snap.checkins[c.id] = stableCheckin(c);
        changed = true;
      }
      for (const d of r.deleted || []) {
        if (d.entity === 'goal') { DB.goals = DB.goals.filter(g => g.id !== d.id); DB.checkins = DB.checkins.filter(c => c.goalId !== d.id); delete cs.snap.goals[d.id]; changed = true; }
        if (d.entity === 'checkin') { DB.checkins = DB.checkins.filter(c => c.id !== d.id); delete cs.snap.checkins[d.id]; changed = true; }
      }
      if (r.settings && me()) { applyServerSettings(me(), r.settings); cs.snap.settings = JSON.stringify(toServerSettings(me())); changed = true; }
      cs.cursor = r.cursor;
      if (!r.hasMore) break;
    }
    S.pulledOnce = true; cs.pulled = true;
    if (changed) { rawSave(); applyTheme(); softRender(); }
  }
  function deviceId() { const d = ls.get('pepsgoal.device.v1') || uuid(); ls.set('pepsgoal.device.v1', d); return d; }
  function ensureUserStub(id) {
    if (!id || userById(id)) return;
    const u = Object.assign({ id, username: 'membre', name: 'Membre PepsGoal', hue: 0, bio: '', demo: false, passHash: null, salt: null, createdAt: Date.now(), settings: defSettings(), milestones: [], _stub: true }, newUserFields(0));
    DB.users.push(u);
  }
  function refreshSyncCard() { if (UI.view === 'settings' && UI.setCat === 'data') softRender(); }

  /* =========================================================================================
   * Fonctions sociales : miroir des données du serveur dans la base de l'application
   * ========================================================================================= */
  let socialTimer = null;
  function scheduleSocial(ms = 400) { if (!S.acct) return; clearTimeout(socialTimer); socialTimer = setTimeout(() => void refreshSocial(), ms); }
  async function refreshSocial() {
    if (!S.acct || !NET.online) return;
    if (S.refreshing) return S.refreshing;
    S.refreshing = (async () => {
      try {
        const [meR, fr, feedF, feedP, stories, notifs, convs] = await Promise.all([
          api('GET', '/v1/me'), api('GET', '/v1/friends'), api('GET', '/v1/feed?tab=friends'), api('GET', '/v1/feed?tab=public'),
          api('GET', '/v1/stories'), api('GET', '/v1/notifications'), api('GET', '/v1/conversations')
        ]);
        const mine = meId();
        // Moi
        const u = upsertUser(meR, { bio: meR.bio || '', freezes: meR.freezes || 0, createdAt: msOf(meR.createdAt) || Date.now() });
        u.ban = banOf(meR.moderation); u.warned = meR.moderation?.warned ? { at: Date.now(), reason: '', by: null } : null; u.noComments = !!meR.moderation?.commentsRestricted;
        u._welcomeBonus = !!meR.welcomeBonus; u.tutoBonus = !!meR.welcomeBonus || u.tutoBonus;
        const ap = meR.moderation?.lastAppeal;
        DB.appeals = (DB.appeals || []).filter(a => a.userId !== mine);
        if (ap) DB.appeals.push({ id: 'appeal-' + mine, userId: mine, text: '', at: msOf(ap.createdAt), status: ap.status, answer: ap.answer || '' });
        // Amis et demandes
        DB.friendships = [];
        for (const f of fr.friends) { upsertUser(f.user, { _days: f.days || [], _pts: f.points || 0 }); DB.friendships.push({ id: f.friendshipId, from: mine, to: f.user.id, status: 'accepted', at: msOf(f.since) || Date.now() }); }
        for (const f of fr.incoming) { upsertUser(f.user); DB.friendships.push({ id: f.friendshipId, from: f.user.id, to: mine, status: 'pending', at: Date.now() }); }
        for (const f of fr.outgoing) { upsertUser(f.user); DB.friendships.push({ id: f.friendshipId, from: mine, to: f.user.id, status: 'pending', at: Date.now() }); }
        // Feed
        const posts = new Map();
        for (const p of [...feedF.posts, ...feedP.posts]) {
          upsertUser(p.author); (p.likers || []).forEach(l => upsertUser(l)); p.comments.forEach(c => upsertUser(c.author));
          posts.set(p.id, {
            id: p.id, userId: p.author.id, text: p.text, visibility: p.visibility === 'public' ? 'public' : 'friends', goalId: p.goalId && DB.goals.some(g => g.id === p.goalId) ? p.goalId : null,
            kind: p.kind || 'manual', at: msOf(p.createdAt), likes: (p.likers || []).map(l => l.id), comments: p.comments.map(c => ({ id: c.id, userId: c.author.id, text: c.text, at: msOf(c.createdAt) })),
            ...(p.status === 'pending' ? { status: 'pending' } : {}), ...(p.commentsLocked ? { commentsLocked: true } : {})
          });
        }
        if (isAdmin(u)) for (const p of DB.posts) if (p._mod && !posts.has(p.id)) posts.set(p.id, p);
        DB.posts = [...posts.values()];
        // Stories
        DB.stories = [];
        for (const grp of stories) {
          upsertUser(grp.author);
          for (const s of grp.stories) DB.stories.push({ id: s.id, userId: grp.author.id, kind: s.kind, data: s.data || undefined, photo: s.mediaUrl || undefined, text: s.text || '', at: msOf(s.createdAt), seenBy: s.seen ? [mine] : [], _views: s.viewCount });
        }
        await Promise.all(DB.stories.filter(s => s.userId === mine && s._views).map(async s => {
          try { const v = await api('GET', `/v1/stories/${s.id}/views`); v.forEach(x => upsertUser(x)); s.seenBy = v.map(x => x.id); } catch (e) { /* liste indisponible */ }
        }));
        // Notifications du serveur + rappels locaux
        const VIEW = { like: 'feed', comment: 'feed', friend: 'friends', official: 'friends', mod: 'feed' };
        DB.notifs = DB.notifs.filter(n => !n._srv && n.userId === mine).concat(notifs.map(n => ({
          id: n.id, userId: mine, type: n.type, text: n.text, at: msOf(n.createdAt), read: n.read, _srv: true,
          ...(VIEW[n.type] ? { view: VIEW[n.type] } : {}), ...(n.data?.goalId ? { goalId: n.data.goalId } : {}), ...(n.data?.postId ? { postId: n.data.postId } : {})
        })));
        // Conversations : dernier message de chacune, et conversations non lues chargées en entier
        for (const c of convs) {
          upsertUser(c.peer);
          if (c.unread > 0 || !DB.messages.some(m => m.from === c.peer.id || m.to === c.peer.id)) await loadConversation(c.peer.id, true);
        }
        if (isAdmin(u)) await refreshModeration();
        repairRefs(DB);
        rawSave();
        await decryptAll();
        softRender(); updateBadges(); updateBell();
      } catch (e) { if (e.status !== 0) console.warn('PepsGoal : actualisation sociale impossible', e); }
      finally { S.refreshing = null; }
    })();
    return S.refreshing;
  }
  async function loadConversation(peerId, quiet) {
    const list = await api('GET', `/v1/conversations/${peerId}`);
    const mine = meId();
    DB.messages = DB.messages.filter(m => !((m.from === peerId && m.to === mine) || (m.from === mine && m.to === peerId)));
    for (const m of list) {
      DB.messages.push({
        id: m.id, from: m.mine ? mine : peerId, to: m.mine ? peerId : mine, at: msOf(m.createdAt), read: m.mine || m.read || !quiet,
        ...(m.e2e ? { e2e: m.e2e } : { text: m.text || '' }), ...(m.official ? { official: true, tag: m.tag || 'info', bid: m.id } : {})
      });
    }
  }
  async function refreshModeration() {
    const [users, pending, reported, recent, apP, apD, log, maint, news] = await Promise.all([
      api('GET', '/v1/admin/users'), api('GET', '/v1/admin/posts?scope=pending'), api('GET', '/v1/admin/posts?scope=reported'), api('GET', '/v1/admin/posts?scope=recent'),
      api('GET', '/v1/admin/appeals?status=pending'), api('GET', '/v1/admin/appeals?status=done'), api('GET', '/v1/admin/modlog'), api('GET', '/v1/admin/maintenance'), api('GET', '/v1/admin/announcements')
    ]);
    const mine = meId();
    for (const x of users) {
      const u = upsertUser(x, { createdAt: msOf(x.createdAt) || Date.now(), noComments: !!x.commentsRestricted });
      u.ban = banOf({ banPermanent: x.banPermanent, banUntil: x.banUntil, banReason: x.banReason });
      u.warned = x.warnedAt ? { at: msOf(x.warnedAt), reason: x.warnReason || '', by: null } : null;
    }
    const byId = new Map(DB.posts.map(p => [p.id, p]));
    DB.reports = [];
    for (const p of [...pending, ...reported, ...recent]) {
      upsertUser(p.author);
      const cur = byId.get(p.id) || { id: p.id, userId: p.author.id, text: p.text, visibility: p.visibility === 'public' ? 'public' : 'friends', goalId: null, kind: 'manual', at: msOf(p.createdAt), likes: [], comments: [], _mod: true };
      if (p.status === 'pending') cur.status = 'pending'; else delete cur.status;
      if (p.commentsLocked) cur.commentsLocked = true; else delete cur.commentsLocked;
      if (!byId.has(p.id)) { DB.posts.push(cur); byId.set(p.id, cur); }
      if (p.reportCount) for (let i = 0; i < p.reportCount; i++) DB.reports.push({ id: `${p.id}:${i}`, postId: p.id, by: mine, reason: p.reasons[i % Math.max(1, p.reasons.length)] || 'other', at: msOf(p.createdAt) });
    }
    DB.appeals = [...apP, ...apD].map(a => {
      const u = upsertUser(a.user);
      if (a.status === 'pending' && u) u.ban = banOf({ banPermanent: a.ban.permanent, banUntil: a.ban.until, banReason: a.ban.reason }) || u.ban;
      return { id: a.id, userId: a.user.id, text: a.text, at: msOf(a.createdAt), status: a.status, answer: a.answer || '', doneAt: msOf(a.decidedAt) };
    });
    DB.modlog = log.slice().reverse().map(l => ({ id: l.id, at: msOf(l.createdAt), admin: null, action: l.action, target: l.targetUserId, detail: [l.detail, l.adminName ? `par ${l.adminName}` : ''].filter(Boolean).join(' · ') }));
    const active = maint.find(m => !m.endedAt && (!m.endsAt || Date.parse(m.endsAt) > Date.now()));
    DB.maintenance = active ? { mode: active.mode, start: msOf(active.startsAt), until: msOf(active.endsAt), message: active.message || '', _id: active.id } : null;
    DB.maintLog = maint.slice().reverse().map(m => ({ id: m.id, at: msOf(m.startsAt), by: null, mode: m.mode, start: msOf(m.startsAt), until: msOf(m.endsAt), message: m.message, endedAt: msOf(m.endedAt) }));
    DB.news = news.slice().reverse().map(n => ({ id: n.id, text: n.text, at: msOf(n.createdAt) }));
  }
  function applyMaintenanceStatus() {
    if (!S.acct || isAdmin(me())) return;
    const m = maintenanceStatus;
    const next = m ? { mode: m.mode, start: Date.now() - 1000, until: msOf(m.endsAt), message: m.message || '' } : null;
    if (JSON.stringify(next && { ...next, start: 0 }) !== JSON.stringify(DB.maintenance && { ...DB.maintenance, start: 0 })) { DB.maintenance = next; rawSave(); render(); }
  }

  /* =========================================================================================
   * Messages privés : chiffrement de bout en bout (docs/E2E.md), clés rangées sur l'appareil
   * ========================================================================================= */
  const b64e = u8 => { let s = ''; u8.forEach(c => { s += String.fromCharCode(c); }); return btoa(s); };
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const keyStore = () => { const all = ls.get(DEV_KEY) || {}; const k = all[meId()] || { device: null, pairs: {} }; return { all, k }; };
  function keySave(k) { const all = ls.get(DEV_KEY) || {}; all[meId()] = k; ls.set(DEV_KEY, all); }
  async function e2eDevice() {
    const { k } = keyStore();
    if (k.device) return k.device;
    const kp = nacl.box.keyPair();
    const r = await api('POST', '/v1/e2e/devices', { publicKey: b64e(kp.publicKey) });
    k.device = { id: r.deviceId, pk: b64e(kp.publicKey), sk: b64e(kp.secretKey) };
    keySave(k);
    return k.device;
  }
  function wrapKey(key, recipientPk, senderSk) {
    const nonce = nacl.randomBytes(24);
    return { nonce: b64e(nonce), box: b64e(nacl.box(b64d(key), nonce, b64d(recipientPk), b64d(senderSk))) };
  }
  function unwrapKey(env, senderPk, sk) {
    try { const k = nacl.box.open(b64d(env.box), b64d(env.nonce), b64d(senderPk), b64d(sk)); return k && k.length === 32 ? b64e(k) : null; } catch (e) { return null; }
  }
  async function uploadEnvelopes(peerId, keyId, key, dev, targets) {
    if (!targets.length) return;
    await api('POST', `/v1/e2e/peers/${peerId}/keys`, { keyId, envelopes: targets.map(d => Object.assign({ deviceId: d.id, senderDeviceId: dev.id }, wrapKey(key, d.publicKey, dev.sk))) });
  }
  // Prépare une conversation : ouvre les enveloppes reçues, transmet les clés aux appareils qui ne les ont pas, crée la première clé
  async function e2eOpen(peerId) {
    const dev = await e2eDevice();
    let st = await api('GET', `/v1/e2e/peers/${peerId}?deviceId=${dev.id}`);
    const { k } = keyStore();
    for (const x of st.keys) if (x.envelope && !k.pairs[x.keyId]) { const key = unwrapKey(x.envelope, x.envelope.senderPublicKey, dev.sk); if (key) k.pairs[x.keyId] = key; }
    if (!st.keys.length) {
      const keyId = uuid(), key = b64e(nacl.randomBytes(32));
      await uploadEnvelopes(peerId, keyId, key, dev, st.devices);
      k.pairs[keyId] = key;
      st = await api('GET', `/v1/e2e/peers/${peerId}?deviceId=${dev.id}`);
    }
    keySave(k);
    const byId = new Map(st.devices.map(d => [d.id, d]));
    let current = null;
    for (const x of st.keys) {
      const key = k.pairs[x.keyId]; if (!key) continue;
      current = current || { keyId: x.keyId, key };
      const missing = x.missingDevices.map(id => byId.get(id)).filter(Boolean);
      await uploadEnvelopes(peerId, x.keyId, key, dev, missing).catch(() => undefined);
    }
    return { current, waiting: !current && st.keys.length > 0 };
  }
  async function e2eShareMissing() {
    const { k } = keyStore(); if (!k.device) return;
    const pend = await api('GET', `/v1/e2e/pending?deviceId=${k.device.id}`);
    for (const p of pend) {
      const key = k.pairs[p.keyId] || unwrapKey(p.envelope, p.envelope.senderPublicKey, k.device.sk); if (!key) continue;
      k.pairs[p.keyId] = key;
      await uploadEnvelopes(p.peerId, p.keyId, key, k.device, p.missingDevices).catch(() => undefined);
    }
    keySave(k);
  }
  async function e2eForget(notifyServer) {
    const { all, k } = keyStore();
    if (k.device && notifyServer) await api('DELETE', `/v1/e2e/devices/${k.device.id}`).catch(() => undefined);
    delete all[meId()]; ls.set(DEV_KEY, all);
  }
  function naclDecrypt(m) {
    const p = m.e2e, key = keyStore().k.pairs[p.keyId]; if (!key) return null;
    try { const out = nacl.secretbox.open(b64d(p.ct), b64d(p.nonce), b64d(key)); return out ? new TextDecoder().decode(out) : null; } catch (e) { return null; }
  }
  async function decryptAll() {
    for (const m of DB.messages) if (m.e2e && (!E2E.cache.has(m.id) || E2E.cache.get(m.id) == null)) E2E.cache.set(m.id, naclDecrypt(m));
  }

  /* =========================================================================================
   * Envoi des photos (profil, stories) : les images restent sur le serveur PepsGoal
   * ========================================================================================= */
  async function uploadDataUrl(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const fd = new FormData(); fd.append('file', blob, 'photo.jpg');
    return (await api('POST', '/v1/media', fd)).url;
  }

  /* =========================================================================================
   * Branchement sur l'application : chaque fonction d'origine reste utilisée hors compte
   * ========================================================================================= */
  const O = {};
  function install() {
    // Réseau : en ligne = connexion de l'appareil ET serveur joignable
    Object.defineProperty(NET, 'online', { configurable: true, get: () => S.navOnline && S.serverOk, set: () => undefined });
    const guardNet = e => { if (!e.pg) { e.stopImmediatePropagation(); S.navOnline = navigator.onLine !== false; if (S.navOnline) { S.failures = 0; void ping(); } else setOnline(false); } };
    window.addEventListener('online', guardNet, true);
    window.addEventListener('offline', guardNet, true);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { S.failures = 0; void ping(); if (S.acct) { scheduleSync(300); scheduleSocial(600); } } });

    // Sauvegarde : base du compte à part, puis synchronisation différée
    O.save = save;
    window.rawSave = function () { if (SANDBOX) return; if (S.acct) ls.set(ACCT_KEY, DB); else O.save(); };
    save = function () { rawSave(); if (S.acct) scheduleSync(); };
    // Les autres onglets ne doivent pas recharger la base locale par-dessus celle du compte
    window.addEventListener('storage', e => { if (S.acct && e.key === KEY) e.stopImmediatePropagation(); }, true);

    O.uid = null;
    O.notify = notify;
    notify = function (userId, text, extra = {}) {
      if (S.acct && userId !== meId()) {
        const t = ['badge', 'verify', 'friend'].includes(extra.type) ? extra.type : 'info';
        if (['mod', 'like', 'comment', 'official'].includes(extra.type)) return; // déjà envoyées par le serveur
        if (UUID_RE.test(userId)) void api('POST', '/v1/notify', { to: userId, text: String(text).slice(0, 300), type: t, goalId: extra.goalId && UUID_RE.test(extra.goalId) ? extra.goalId : null }).catch(() => undefined);
        return;
      }
      return O.notify(userId, text, extra);
    };
    O.autoPost = autoPost;
    autoPost = function (u, g, text) {
      if (!S.acct) return O.autoPost(u, g, text);
      if (!socialOn(u) || g.visibility === 'private' || isBanned(u) || maintBlocks(u)) return;
      void api('POST', '/v1/posts', { text: String(text).slice(0, 500), visibility: g.visibility === 'public' ? 'public' : 'friends', goalId: UUID_RE.test(g.id) ? g.id : null, kind: 'milestone' })
        .then(() => scheduleSocial(800)).catch(() => undefined);
    };
    O.requestVerify = requestVerify; requestVerify = function (g, c) { if (!S.acct) return O.requestVerify(g, c); };
    O.receiveCheer = receiveCheer; receiveCheer = function (...a) { if (!S.acct) return O.receiveCheer(...a); };
    O.demoReactions = demoReactions; demoReactions = function (p) { if (!S.acct) return O.demoReactions(p); };
    O.confirmCheck = confirmCheck;
    confirmCheck = function (cid, ok) {
      if (!S.acct) return O.confirmCheck(cid, ok);
      void api('POST', `/v1/checkins/${cid}/${ok ? 'confirm' : 'refuse'}`, {}).then(() => syncNow()).catch(fail);
    };
    O.applyFreezes = applyFreezes;
    applyFreezes = function (u) {
      // Sur un nouvel appareil, l'historique n'est pas encore là : on n'utilise aucun gel avant la première synchronisation
      if (S.acct && !pulledBefore()) return;
      const before = u?.freezes || 0;
      O.applyFreezes(u);
      if (S.acct && u && u.id === meId() && u.freezes < before) {
        void api('POST', '/v1/me/freezes/use', { count: before - u.freezes }).then(r => { u.freezes = r.freezes; rawSave(); }).catch(() => undefined);
      }
    };
    // Séries et flammes des amis : calculées par le serveur (leurs validations ne sont pas copiées sur l'appareil)
    O.checkReminders = checkReminders;
    checkReminders = function () { if (S.acct && !pulledBefore()) return; return O.checkReminders(); };
    O.activeDays = activeDays;
    activeDays = function (id) { const u = S.acct && id !== meId() ? userById(id) : null; return u && u._days ? new Set(u._days) : O.activeDays(id); };
    O.points = points;
    points = function (id) { const u = S.acct && id !== meId() ? userById(id) : null; return u && u._pts !== undefined ? u._pts : O.points(id); };
    O.friendsOf = friendsOf;
    friendsOf = function (id) { const u = S.acct && id !== meId() ? userById(id) : null; const own = O.friendsOf(id); return u && u._friendCount !== undefined && own.length < u._friendCount ? own.concat(Array(u._friendCount - own.length).fill('')) : own; };
    // Photos hébergées sur le serveur
    O.avatar = avatar;
    avatar = function (u, size = 40, a = u.avatar) {
      if (a && a.kind === 'photo' && /^https:\/\//.test(a.photo || '')) {
        return `<span class="av photo" style="--s:${size}px;background:${accentGrad(a.color)}" aria-hidden="true"><img src="${esc(a.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
      }
      return O.avatar(u, size, a);
    };
    // Messages : chiffrement du serveur à la place du chiffrement local du prototype
    O.e2eDecrypt = e2eDecrypt; e2eDecrypt = async function (m) { return S.acct ? naclDecrypt(m) : O.e2eDecrypt(m); };
    O.encryptLegacy = encryptLegacy; encryptLegacy = async function () { if (!S.acct) return O.encryptLegacy(); };
    O.keyPrint = keyPrint;
    keyPrint = async function (a, b) {
      if (!S.acct) return O.keyPrint(a, b);
      const peer = a === meId() ? b : a, st = await api('GET', `/v1/e2e/peers/${peer}?deviceId=${(await e2eDevice()).id}`);
      const pks = st.devices.map(d => d.publicKey).sort().join('|');
      const h = nacl.hash(new TextEncoder().encode(pks));
      return Array.from({ length: 6 }, (_, i) => String(((h[i * 3] << 16) | (h[i * 3 + 1] << 8) | h[i * 3 + 2]) % 100000).padStart(5, '0')).join(' ');
    };
    O.sendMessage = sendMessage;
    sendMessage = async function (to, text) {
      if (!S.acct) return O.sendMessage(to, text);
      try {
        const conv = await e2eOpen(to);
        if (!conv.current) { toast('La clé de cette conversation arrive dès que ton ami ouvre PepsGoal. Réessaie dans un instant.', 'lock'); return; }
        const nonce = nacl.randomBytes(24);
        const e2e = { v: 1, keyId: conv.current.keyId, nonce: b64e(nonce), ct: b64e(nacl.secretbox(new TextEncoder().encode(text), nonce, b64d(conv.current.key))) };
        const r = await api('POST', `/v1/conversations/${to}`, { e2e });
        E2E.cache.set(r.id, text);
        DB.messages.push({ id: r.id, from: meId(), to, e2e, at: msOf(r.createdAt) || Date.now(), read: true });
        rawSave(); updateChat(); updateBadges();
      } catch (e) { fail(e); }
    };
    O.renderStoryView = renderStoryView;
    renderStoryView = function () {
      O.renderStoryView();
      const s = UI.fs?.groups?.[UI.fs.ui]?.list?.[UI.fs.si];
      if (S.acct && s && s.userId !== meId() && !S.viewed.has(s.id)) { S.viewed.add(s.id); void api('POST', `/v1/stories/${s.id}/view`, {}).catch(() => undefined); }
    };
    // Recherche d'amis : sur le serveur
    O.friendResults = friendResults;
    friendResults = function () {
      if (!S.acct) return O.friendResults();
      const q = UI.friendQuery.trim();
      if (q !== S.search.q) {
        S.search.q = q; S.search.busy = true;
        clearTimeout(S.search.t);
        S.search.t = setTimeout(() => api('GET', '/v1/users/search?q=' + encodeURIComponent(q)).then(list => {
          S.search.list = list.map(p => upsertUser(p)).filter(Boolean); S.search.busy = false;
          const r = document.getElementById('friend-results'); if (r) r.innerHTML = friendResults();
        }).catch(() => { S.search.busy = false; }), 250);
      }
      const u = me(), others = S.search.list.filter(x => x && x.id !== u.id && !friendship(u.id, x.id));
      if (S.search.busy && !others.length) return `<p class="muted small">Recherche…</p>`;
      return others.length ? `<ul class="people">${others.map(x => personRow(x, `<button class="btn sm" data-act="add-friend" data-id="${x.id}">${icon('userplus')}Ajouter</button>`)).join('')}</ul>`
        : `<p class="muted small">${q ? 'Aucun résultat pour cette recherche.' : 'Tape un nom ou un @utilisateur pour trouver des amis.'}</p>`;
    };
    O.securityCard = securityCard;
    securityCard = function (u) {
      if (!S.acct) return O.securityCard(u);
      return `<section class="glass card"><div class="card-h"><h2>Mot de passe</h2></div>
        <form class="gform" data-form="password">
          <div class="field"><label for="pw-cur">Mot de passe actuel</label><input type="password" id="pw-cur" name="cur" autocomplete="current-password"></div>
          <div class="field-row">
            <div class="field"><label for="pw-new">Nouveau mot de passe</label><input type="password" id="pw-new" name="next" autocomplete="new-password" placeholder="8 caractères minimum"></div>
            <div class="field"><label for="pw-new2">Confirmation</label><input type="password" id="pw-new2" name="next2" autocomplete="new-password"></div>
          </div>
          <p class="form-err" id="pw-err" role="alert" hidden></p>
          <div class="sheet-f"><button class="btn btn-primary" type="submit">${icon('lock')}Changer le mot de passe</button></div>
        </form></section>`;
    };
    O.syncCard = syncCard;
    syncCard = function (u) {
      if (!S.acct) return O.syncCard(u);
      const n = pendingCount();
      const state = !NET.online ? ['cloudoff', 'Hors ligne', `Tes modifications sont gardées sur cet appareil${n ? ` (${pl(n, 'modification', 'modifications')} en attente)` : ''} et partiront au retour de la connexion.`]
        : S.syncing ? ['cloud', 'Synchronisation…', 'Envoi et réception de tes données en cours.']
        : S.syncError ? ['cloudoff', 'Erreur', S.syncError]
        : ['cloud', 'À jour', S.lastSync ? `Dernière synchronisation ${ago(S.lastSync)}. Tes objectifs sont sauvegardés sur le serveur PepsGoal et disponibles sur tous tes appareils.` : 'Tes objectifs sont sauvegardés sur le serveur PepsGoal.'];
      return `<section class="glass card"><div class="set-row"><div><b>Synchronisation</b><small>${esc(state[2])}</small></div><span class="chip ${NET.online && !S.syncError ? 't-goal' : 'st-warn'}">${icon(state[0])}${esc(state[1])}</span></div>
        <div class="quick" style="margin-top:10px"><button class="btn sm" data-act="cloud-sync" ${NET.online ? '' : 'disabled'}>${icon('cloud')}Synchroniser maintenant</button></div></section>`;
    };
    // Fenêtres propres au mode connecté (suppression du compte avec mot de passe)
    O.renderModal = renderModal;
    renderModal = function () {
      const m = UI.modal;
      if (m && m.type === 'cloudDelete') {
        modalRoot.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="m-title">${sheetHead('Supprimer ton compte ?')}
          <form class="gform" data-form="cloud-delete"><p class="muted">Ton profil, tes objectifs, tes publications, tes stories et tes messages seront supprimés définitivement du serveur PepsGoal et de cet appareil.</p>
          <div class="field"><label for="cd-pw">Confirme avec ton mot de passe</label><input type="password" id="cd-pw" name="password" autocomplete="current-password" autofocus></div>
          <p class="form-err" id="cd-err" role="alert" hidden></p>
          <div class="sheet-f"><button class="btn btn-ghost" type="button" data-act="close">Annuler</button><button class="btn btn-danger" type="submit">${icon('trash')}Supprimer définitivement</button></div></form></div></div>`;
        lockScroll(); modalRoot.querySelector('[autofocus]')?.focus();
        return;
      }
      O.renderModal();
      if (S.acct && m && m.type === 'user' && !S.profileLoaded.has(m.id) && m.id !== meId()) void loadProfile(m.id);
    };
    SET_BODY.help = (orig => function (u) {
      if (!S.acct) return orig(u);
      return orig(u).replace('Version web : les données restent dans ce navigateur.', 'Compte synchronisé avec le serveur PepsGoal.');
    })(SET_BODY.help);
    // Application mobile : les fichiers exportés passent par la feuille de partage du téléphone
    if (window.ReactNativeWebView) {
      saveFile = async function (filename, blob) {
        const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'file', filename, mime: blob.type || 'application/zip', data }));
      };
    }
    installActions();
  }

  async function loadProfile(id) {
    S.profileLoaded.set(id, true);
    try {
      const p = await api('GET', `/v1/users/${id}`);
      const u = upsertUser(p.user, { bio: p.user.bio || '', createdAt: msOf(p.user.createdAt) || Date.now(), _days: p.days, _pts: p.points, _friendCount: p.friendCount });
      for (const sg of p.goals) {
        const g = fromServerGoal(sg); (g.members || []).forEach(ensureUserStub);
        const i = DB.goals.findIndex(x => x.id === g.id);
        if (g.userId === meId()) continue;
        if (i >= 0) DB.goals[i] = g; else DB.goals.push(g);
      }
      const known = new Set(DB.checkins.map(c => c.id));
      for (const sc of p.checkins) if (!known.has(sc.id) && sc.userId !== meId()) { ensureUserStub(sc.userId); DB.checkins.push(fromServerCheckin(sc)); }
      rawSave();
      if (UI.modal?.type === 'user' && UI.modal.id === id) O.renderModal();
      void u;
    } catch (e) { S.profileLoaded.delete(id); }
  }

  /* ---------- actions et formulaires ---------- */
  function installActions() {
    const A = Object.assign({}, ACT), F = Object.assign({}, FORMS);
    const wrapA = (name, fn) => { const orig = A[name]; ACT[name] = (...a) => (S.acct ? fn(...a) : orig?.(...a)); };
    const wrapF = (name, fn) => { const orig = F[name]; FORMS[name] = function (f) { return S.acct ? fn.call(this, f) : orig?.call(this, f); }; };
    const after = (p, msg, ic) => p.then(() => { if (msg) toast(msg, ic); scheduleSocial(150); }).catch(fail);

    ACT['cloud-sync'] = () => { void syncNow().then(() => { refreshSocial(); toast(S.syncError ? S.syncError : 'Synchronisation terminée.', S.syncError ? 'x' : 'cloud'); }); };

    // Connexion, inscription, déconnexion
    FORMS.login = async function (f) {
      const d = Object.fromEntries(new FormData(f)), un = (d.username || '').trim().toLowerCase();
      if (!un || !d.password) { UI.authError = "Indique ton nom d'utilisateur et ton mot de passe."; return render(); }
      if (!NET.online) { UI.authError = 'Hors ligne : la connexion à un compte nécessite internet. Tu peux continuer sans compte en attendant.'; return render(); }
      try { await connect(await api('POST', '/v1/auth/login', { username: un, password: d.password })); }
      catch (e) { UI.authError = e.message; render(); }
    };
    FORMS.signup = async function (f) {
      const d = Object.fromEntries(new FormData(f)), un = (d.username || '').trim().toLowerCase(), name = (d.name || '').trim();
      if (name.length < 2) { UI.authError = 'Indique ton nom (2 caractères minimum).'; return render(); }
      if (!/^[a-z0-9._]{3,20}$/.test(un)) { UI.authError = "Le nom d'utilisateur doit faire 3 à 20 caractères : lettres, chiffres, point ou tiret bas."; return render(); }
      if ((d.password || '').length < 8) { UI.authError = 'Le mot de passe doit contenir au moins 8 caractères.'; return render(); }
      if (!NET.online) { UI.authError = 'Hors ligne : la création d’un compte nécessite internet.'; return render(); }
      try { await connect(await api('POST', '/v1/auth/register', { username: un, displayName: name, password: d.password, acceptTerms: true }), true); }
      catch (e) { UI.authError = e.message; render(); }
    };
    FORMS['guest-upgrade'] = async function (f) {
      const fd = new FormData(f), u = me(), err = f.querySelector('#gu-err'), failF = m => { err.textContent = m; err.hidden = false; };
      const name = String(fd.get('name') || '').trim(), un = String(fd.get('username') || '').trim().toLowerCase(), pw = String(fd.get('password') || '');
      if (!isGuest(u)) return;
      if (!NET.online) return failF('Hors ligne : la création du compte nécessite internet.');
      if (name.length < 2) return failF('Indique ton nom (2 caractères minimum).');
      if (!/^[a-z0-9._]{3,20}$/.test(un)) return failF("Le nom d'utilisateur doit faire 3 à 20 caractères : lettres, chiffres, point ou tiret bas.");
      if (pw.length < 8) return failF('Le mot de passe doit contenir au moins 8 caractères.');
      let payload;
      try { payload = await api('POST', '/v1/auth/register', { username: un, displayName: name, password: pw, acceptTerms: true }); } catch (e) { return failF(e.message); }
      // Le profil sans compte devient le compte : objectifs, validations, groupes et réglages sont conservés puis envoyés
      const guestDb = DB, gid = u.id, nid = payload.user.id;
      const db = newAccountDB(payload.user);
      db.goals = guestDb.goals.filter(g => g.userId === gid).map(g => Object.assign({}, g, { userId: nid }));
      db.checkins = guestDb.checkins.filter(c => c.userId === gid).map(c => Object.assign({}, c, { userId: nid }));
      enterAccount(payload, db);
      const nu = me();
      Object.assign(nu, { goalGroups: u.goalGroups || [], goalGroupOf: u.goalGroupOf || {}, tutorialDone: u.tutorialDone, frozenDays: u.frozenDays || [], milestones: u.milestones || [] });
      Object.assign(nu.settings, u.settings, { social: true });
      // Le profil sans compte est retiré de la base locale
      const local = migrate(load() || emptyDB()); local.users = local.users.filter(x => x.id !== gid); local.goals = local.goals.filter(g => g.userId !== gid); local.checkins = local.checkins.filter(c => c.userId !== gid); local.session = null;
      try { localStorage.setItem(KEY, JSON.stringify(local)); } catch (e) { /* ignoré */ }
      save(); render(); toast('Compte créé : toutes tes données sont conservées et sauvegardées.', 'check');
      afterConnect();
    };
    async function connect(payload, created) {
      const cached = ls.get(ACCT_KEY);
      const db = cached && cached.session === payload.user.id ? cached : newAccountDB(payload.user);
      enterAccount(payload, db);
      UI.authError = ''; UI.view = 'today'; UI.modal = null; UI.renderedView = null;
      render();
      if (created) toast('Bienvenue sur PepsGoal !', 'flame');
      afterConnect();
    }
    function afterConnect() {
      void e2eDevice().then(() => e2eShareMissing()).catch(() => undefined);
      void syncNow().then(() => {
        const u = me(); if (!u) return;
        if (!u.tutorialDone && !UI.modal) { UI.modal = { type: 'tuto', step: 0 }; renderModal(); }
        setTimeout(checkReminders, 800);
        return refreshSocial();
      });
    }
    wrapA('logout', () => {
      if (!NET.online) return toast('Hors ligne : la déconnexion et le changement de compte reviendront avec la connexion.', 'cloudoff');
      if (DB.timers?.[meId()]) stopTimer(me(), true);
      void syncNow().then(() => {
        // Le serveur doit avoir confirmé la synchronisation : sinon on garde la session (aucune donnée perdue)
        if (!NET.online || S.syncError) { toast('Hors ligne : la déconnexion et le changement de compte reviendront avec la connexion.', 'cloudoff'); render(); return; }
        if (pendingCount() > 0) { toast('Des modifications ne sont pas encore synchronisées : réessaie dans un instant.', 'cloudoff'); return; }
        leaveAccount(true);
      });
    });
    wrapA('reset', () => toast('Ton compte est sauvegardé sur le serveur : déconnecte-toi pour effacer ses données de cet appareil.', 'cloud'));
    wrapA('delete-me', () => { if (isAdmin(me())) return; UI.modal = { type: 'cloudDelete' }; renderModal(); });
    FORMS['cloud-delete'] = async function (f) {
      const pw = String(new FormData(f).get('password') || ''), err = f.querySelector('#cd-err');
      try { await api('DELETE', '/v1/me', { password: pw }); await e2eForget(false); toast('Ton compte a été supprimé.', 'trash'); leaveAccount(false); }
      catch (e) { err.textContent = e.message; err.hidden = false; }
    };
    wrapF('password', async function (f) {
      const fd = new FormData(f), err = f.querySelector('#pw-err'), failF = m => { err.textContent = m; err.hidden = false; };
      const cur = fd.get('cur') || '', next = fd.get('next') || '', next2 = fd.get('next2') || '';
      if (next.length < 8) return failF('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      if (next === cur) return failF('Choisis un mot de passe différent de l’actuel.');
      if (next !== next2) return failF('Les deux nouveaux mots de passe ne correspondent pas.');
      try { const r = await api('POST', '/v1/auth/password', { current: cur, next }); S.tokens = { accessToken: r.accessToken, refreshToken: r.refreshToken }; ls.set(TOK_KEY, S.tokens); f.reset(); toast('Mot de passe modifié. Tes autres appareils devront se reconnecter.', 'lock'); }
      catch (e) { failF(e.message); }
    });
    wrapF('profile', async function (f) {
      const fd = new FormData(f), u = me(), name = (fd.get('name') || '').trim(), bio = (fd.get('bio') || '').trim();
      if (name.length < 2) { toast('Le nom doit contenir au moins 2 caractères.', 'x'); return; }
      try { await api('PATCH', '/v1/me', { displayName: name, bio }); u.name = name; u.bio = bio; rawSave(); render(); toast('Profil enregistré.'); } catch (e) { fail(e); }
    });
    wrapA('av-save', async () => {
      const d = UI.modal.draft;
      if (d.kind === 'photo' && !d.photo) { toast('Choisis une photo, ou un autre type d’icône.', 'image'); return; }
      try {
        let photoUrl = null;
        if (d.kind === 'photo') photoUrl = /^data:image\//.test(d.photo) ? await uploadDataUrl(d.photo) : d.photo;
        await api('PATCH', '/v1/me', { avatar: { kind: d.kind, color: Number(d.color) || 0, emoji: d.emoji || '', picto: d.picto || 'flameo', photoUrl } });
        me().avatar = Object.assign({}, d, { photo: photoUrl || '' }); UI.modal = null; rawSave(); render(); toast('Icône de profil mise à jour.');
      } catch (e) { fail(e); }
    });
    wrapA('tuto-finish', () => {
      const u = me(); u.tutorialDone = true; UI.modal = null; save(); render();
      void api('POST', '/v1/me/welcome-bonus', {}).then(r => { u.freezes = r.freezes; rawSave(); if (r.granted) { celebrate(TUTO_GELS); toast(`${TUTO_GELS} gels de série ajoutés !`, 'snow'); } softRender(); }).catch(() => undefined);
    });

    // Amis
    sendRequest = (orig => function (to) {
      if (!S.acct) return orig(to);
      if (socialBlocked("d'envoyer des demandes d'amis")) return;
      after(api('POST', '/v1/friends/requests', { userId: to }), 'Demande envoyée.', 'userplus');
    })(sendRequest);
    wrapA('accept', id => after(api('POST', `/v1/friends/requests/${id}/accept`, {}), 'Vous êtes maintenant amis.', 'users'));
    wrapA('decline', id => after(api('POST', `/v1/friends/requests/${id}/decline`, {})));
    wrapA('unfriend', id => {
      const x = userById(id);
      UI.modal = { type: 'confirm', title: `Retirer ${x.name} ?`, text: 'Vous ne verrez plus vos publications réservées aux amis.', ok: 'Retirer', danger: true, run: () => after(api('DELETE', `/v1/friends/${id}`), 'Ami retiré.', 'users') };
      renderModal();
    });

    // Feed
    wrapA('like', id => {
      if (socialBlocked("d'encourager")) return;
      const p = DB.posts.find(x => x.id === id), u = me(); if (!p) return;
      const liked = p.likes.includes(u.id);
      if (liked) p.likes = p.likes.filter(x => x !== u.id); else { p.likes.push(u.id); UI.justLiked = p.id; if (!reduced()) celebrate(1); }
      rawSave(); render();
      api(liked ? 'DELETE' : 'POST', `/v1/posts/${id}/like`, liked ? undefined : {}).catch(e => { fail(e); scheduleSocial(); });
    });
    wrapA('del-post', id => {
      UI.modal = { type: 'confirm', title: 'Supprimer la publication ?', text: 'Elle disparaîtra du feed de tes amis.', ok: 'Supprimer', danger: true, run: () => { DB.posts = DB.posts.filter(p => p.id !== id); rawSave(); render(); after(api('DELETE', `/v1/posts/${id}`)); } };
      renderModal();
    });
    wrapF('post', async function (f) {
      const fd = new FormData(f), text = (fd.get('text') || '').trim();
      if (!text) { toast('Écris quelque chose avant de publier.', 'x'); return; }
      if (socialBlocked('de publier')) return;
      const goal = f.dataset.goal || fd.get('goal') || null;
      try {
        const r = await api('POST', '/v1/posts', { text, visibility: fd.get('vis') === 'public' ? 'public' : 'friends', goalId: goal && UUID_RE.test(goal) ? goal : null, kind: 'manual' });
        UI.modal = null; UI.view = 'feed'; UI.feedTab = fd.get('vis') === 'public' && UI.feedTab === 'public' ? 'public' : 'friends';
        render(); toast(r.status === 'pending' ? 'Envoyé à la modération : ta publication sera visible après validation.' : 'Publié.', 'feed');
        await refreshSocial();
      } catch (e) { fail(e); }
    });
    wrapF('comment', async function (f) {
      const text = (new FormData(f).get('text') || '').trim(); if (!text) return;
      const p = DB.posts.find(x => x.id === f.dataset.id), u = me();
      if (socialBlocked('de commenter')) return;
      if (!canComment(u, p)) { toast(p.commentsLocked ? 'Les commentaires sont fermés sur cette publication.' : 'La modération a restreint tes commentaires.', 'lock'); return; }
      try {
        const r = await api('POST', `/v1/posts/${p.id}/comments`, { text });
        p.comments.push({ id: r.id, userId: u.id, text, at: Date.now() }); rawSave(); render();
        document.getElementById('c-' + p.id)?.focus({ preventScroll: true });
      } catch (e) { fail(e); }
    });
    wrapF('report', async function (f) {
      const reason = new FormData(f).get('reason') || 'other', id = f.dataset.id;
      try { await api('POST', `/v1/posts/${id}/report`, { reason }); UI.modal = null; renderModal(); toast('Merci, la modération va examiner cette publication.', 'flag'); } catch (e) { fail(e); }
    });
    wrapF('appeal', async function (f) {
      const text = String(new FormData(f).get('text') || '').trim(); if (text.length < 10) { toast('Écris au moins quelques mots (10 caractères).', 'x'); return; }
      try { await api('POST', '/v1/appeals', { text }); UI.modal = null; render(); toast('Demande envoyée à la modération.', 'send'); scheduleSocial(); } catch (e) { fail(e); }
    });
    wrapA('open-notifs', () => { A['open-notifs'](); void api('POST', '/v1/notifications/read-all', {}).catch(() => undefined); });
    wrapA('open-chat', id => {
      A['open-chat'](id);
      void loadConversation(id, false).then(async () => { rawSave(); await e2eOpen(id).catch(() => undefined); await decryptAll(); updateChat(); updateBadges(); }).catch(() => undefined);
    });

    // Stories
    wrapA('story-publish', async () => {
      const m = UI.modal, d = storyDraft(m); if (!d) return;
      if (socialBlocked('de publier une story')) return;
      try {
        let body;
        const text = (m.text || '').trim().slice(0, 140);
        if (d.kind === 'photo') body = { kind: 'photo', mediaUrl: await uploadDataUrl(d.photo), text };
        else if (d.kind === 'recap') body = { kind: 'recap', data: { title: String(d.data.title).slice(0, 30), n: Number(d.data.n) || 0, pts: Number(d.data.pts) || 0, best: Number(d.data.best) || 0, reg: Number(d.data.reg) || 0, persona: String(d.data.persona).slice(0, 30), e: String(d.data.e).slice(0, 8) }, text };
        else body = { kind: 'progress', data: { type: d.data.type, icon: String(d.data.icon).slice(0, 16), title: String(d.data.title).slice(0, 80), v: String(d.data.v).slice(0, 24), l: String(d.data.l).slice(0, 60), label: String(d.data.label).slice(0, 30), meta: String(d.data.meta).slice(0, 140), pct: d.data.pct == null ? null : Math.min(1, Math.max(0, Number(d.data.pct))) }, text };
        await api('POST', '/v1/stories', body);
        UI.modal = null; render(); toast('Story publiée : visible par tes amis pendant 24 h.', 'image');
        await refreshSocial();
      } catch (e) { fail(e); }
    });
    wrapA('story-del', id => {
      A['story-del'](id);
      void api('DELETE', `/v1/stories/${id}`).catch(fail);
    });

    // Modération
    const modAct = (path, body, msg, ic) => after(api('POST', path, body || {}), msg, ic);
    wrapA('mod-approve', id => modAct(`/v1/admin/posts/${id}/approve`, null, 'Publication validée.'));
    wrapA('mod-reject', id => modAct(`/v1/admin/posts/${id}/reject`, null, 'Publication refusée.', 'x'));
    wrapA('mod-del-post', id => {
      const p = DB.posts.find(x => x.id === id); if (!p) return;
      UI.modal = { type: 'confirm', title: 'Supprimer cette publication ?', text: `« ${p.text.slice(0, 80)}${p.text.length > 80 ? '…' : ''} » sera supprimée pour tout le monde. L'auteur sera prévenu.`, ok: 'Supprimer', danger: true, run: () => { DB.posts = DB.posts.filter(x => x !== p); render(); modAct(`/v1/admin/posts/${id}/delete`, null, 'Publication supprimée.', 'trash'); } };
      renderModal();
    });
    wrapA('mod-ignore', id => modAct(`/v1/admin/posts/${id}/dismiss`));
    wrapA('mod-lock', id => { const p = DB.posts.find(x => x.id === id); if (p) modAct(`/v1/admin/posts/${id}/${p.commentsLocked ? 'unlock' : 'lock'}`, null, p.commentsLocked ? 'Commentaires rouverts.' : 'Commentaires fermés sur cette publication.', 'lock'); });
    wrapA('mod-warn', id => modAct(`/v1/admin/users/${id}/warn`, { reason: modReason() }, `${userById(id)?.name} est sous avertissement.`, 'bell'));
    wrapA('mod-unwarn', id => modAct(`/v1/admin/users/${id}/unwarn`, null, 'Avertissement levé.'));
    wrapA('mod-ban', id => {
      const d = document.getElementById('mod-dur')?.value || '7';
      modAct(`/v1/admin/users/${id}/ban`, { days: d === 'perm' ? null : Number(d), reason: modReason() }, `${userById(id)?.name} est banni.`, 'ban');
    });
    wrapA('mod-unban', id => modAct(`/v1/admin/users/${id}/unban`, null, 'Ban levé.'));
    wrapA('mod-delete', id => {
      const x = userById(id); if (!x || isAdmin(x)) return;
      UI.modal = { type: 'confirm', title: `Supprimer le compte de ${x.name} ?`, text: 'Le compte, ses objectifs, ses publications, ses commentaires et ses messages seront supprimés définitivement.', ok: 'Supprimer le compte', danger: true, back: { type: 'modUser', id },
        run: () => after(api('DELETE', `/v1/admin/users/${id}`).then(() => { DB.users = DB.users.filter(u => u.id !== id); repairRefs(DB); rawSave(); render(); }), `Compte de ${x.name} supprimé.`, 'trash') };
      renderModal();
    });
    const answer = id => (document.getElementById('ans-' + id)?.value || '').trim().slice(0, 200);
    wrapA('appeal-ok', id => modAct(`/v1/admin/appeals/${id}/accept`, { answer: answer(id) }, 'Ban levé.'));
    wrapA('appeal-no', id => modAct(`/v1/admin/appeals/${id}/refuse`, { answer: answer(id) }, 'Demande refusée.', 'x'));
    wrapA('mod-msg', id => {
      const ta = document.getElementById('mod-msg'), text = (ta?.value || '').trim();
      if (!text) { toast('Écris le message à envoyer.', 'send'); return; }
      after(api('POST', `/v1/admin/users/${id}/message`, { text }).then(() => { if (ta) ta.value = ''; }), `Message envoyé à ${userById(id)?.name} au nom de PepsGoal Officiel.`, 'send');
    });
    wrapF('official', async function (f) {
      const fd = new FormData(f), text = String(fd.get('text') || '').trim(), to = fd.get('to') || 'all', tag = fd.get('tag') || 'news';
      if (!text) { toast('Écris le message à envoyer.', 'send'); return; }
      try { const r = await api('POST', '/v1/admin/announcements', { text, tag, toUserId: to === 'all' ? null : to }); toast(to === 'all' ? `Annonce envoyée à ${pl(r.sent, 'compte', 'comptes')}.` : 'Message envoyé.', 'send'); f.reset(); scheduleSocial(); } catch (e) { fail(e); }
    });
    ACT['news-del'] = (orig => id => (S.acct ? after(api('DELETE', `/v1/admin/announcements/${id}`), 'Nouveauté retirée de la liste des nouveaux inscrits.', 'trash') : orig(id)))(A['news-del']);
    wrapA('maint-end', () => modAct('/v1/admin/maintenance/end', null, 'Maintenance terminée.'));
    wrapA('maint-tool', () => toast('Le serveur nettoie automatiquement ces données toutes les heures.', 'check'));
    wrapF('maint', async function (f) {
      const fd = new FormData(f), mode = fd.get('mode') || 'social';
      const start = fd.get('start') ? new Date(fd.get('start')).getTime() : Date.now();
      const until = fd.get('until') ? new Date(fd.get('until')).getTime() : null;
      try {
        await api('POST', '/v1/admin/maintenance', { mode, startsAt: new Date(start).toISOString(), endsAt: until ? new Date(until).toISOString() : null, message: String(fd.get('message') || '').trim().slice(0, 200), notify: fd.get('notify') === 'on' });
        toast(start > Date.now() ? 'Maintenance programmée.' : 'Maintenance lancée.', 'gauge'); await refreshSocial(); void ping();
      } catch (e) { fail(e); }
    });
    // Restriction des commentaires (case à cocher de la fiche de modération)
    document.addEventListener('change', e => {
      const t = e.target;
      if (S.acct && t.dataset && t.dataset.modNocom) { e.stopImmediatePropagation(); modAct(`/v1/admin/users/${t.dataset.modNocom}/comments`, { restricted: t.checked }, t.checked ? 'Commentaires restreints.' : 'Commentaires autorisés.', 'comment'); }
    }, true);
    // La sauvegarde complète du navigateur ne concerne pas un compte du serveur
    wrapA('zip-export', id => (id === 'full' ? toast('Sur le serveur, les sauvegardes complètes se font avec deploy/backup.sh.', 'archive') : A['zip-export'](id)));
    wrapA('zip-import', id => (id === 'full' ? toast('Restauration complète indisponible pour un compte du serveur.', 'archive') : A['zip-import'](id)));
    wrapA('import-go', () => {
      const d = UI.importData;
      if (d && d.scope === 'account' && d.clean?.user?.id !== meId()) { toast('Ce fichier appartient à un autre compte : connecte-toi avec ce compte pour le restaurer.', 'archive'); return; }
      A['import-go']();
    });
    // Nouvelle vue : on actualise les données sociales
    wrapA('nav', id => { A.nav(id); if (['feed', 'friends', 'mod', 'today'].includes(id)) scheduleSocial(50); });
    wrapA('open-user', id => { S.profileLoaded.delete(id); A['open-user'](id); });
  }

  /* =========================================================================================
   * Démarrage
   * ========================================================================================= */
  function boot() {
    install();
    S.tokens = ls.get(TOK_KEY);
    const cached = ls.get(ACCT_KEY);
    if (S.tokens && cached && cached.session) {
      S.acct = true;
      DB = migrate(cached); dropLocalOfficial(); cloudState();
      if (me() && !me().tutorialDone) UI.modal = { type: 'tuto', step: 0 };
    }
    render();
    void ping().then(() => { if (S.acct) { void e2eDevice().then(() => e2eShareMissing()).catch(() => undefined); void syncNow().then(() => refreshSocial()); } });
    setInterval(() => { if (S.acct && NET.online) { void syncNow(); void refreshSocial(); void e2eShareMissing().catch(() => undefined); } }, 60000);
    setInterval(() => { if (S.acct && NET.online && UI.modal?.type === 'chat') void loadConversation(UI.modal.with, false).then(async () => { await decryptAll(); updateChat(); }).catch(() => undefined); }, 8000);
  }

  window.PGCloud = { boot, syncNow, refreshSocial, state: S };
})();
