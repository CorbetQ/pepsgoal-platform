import type { Checkin, Goal, GoalGroup, SyncOp, UserSettings } from '@pepsgoal/shared';
import type { LocalStore } from './types';

// Web : même interface, données dans le stockage du navigateur (une clé par collection).
const KEY = 'pepsgoal.app.v1';
interface Data { goals: Record<string, Goal>; checkins: Record<string, Checkin>; groups: Record<string, GoalGroup>; outbox: SyncOp[]; meta: Record<string, string> }
let data: Data = { goals: {}, checkins: {}, groups: {}, outbox: [], meta: {} };

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { console.warn('Stockage du navigateur plein : les dernières modifications ne sont pas enregistrées.'); }
}

export const store: LocalStore = {
  async init() {
    try { const raw = localStorage.getItem(KEY); if (raw) data = { ...data, ...JSON.parse(raw) }; } catch { /* données illisibles : on repart de zéro */ }
  },
  async goals() { return Object.values(data.goals); },
  async putGoal(g) { data.goals[g.id] = g; persist(); },
  async removeGoal(id) { delete data.goals[id]; for (const c of Object.values(data.checkins)) if (c.goalId === id) delete data.checkins[c.id]; persist(); },
  async checkins(fromDate) { return Object.values(data.checkins).filter(c => !fromDate || c.date >= fromDate); },
  async putCheckin(c) { data.checkins[c.id] = c; persist(); },
  async removeCheckin(id) { delete data.checkins[id]; persist(); },
  async groups() { return Object.values(data.groups); },
  async putGroup(g) { data.groups[g.id] = g; persist(); },
  async removeGroup(id) { delete data.groups[id]; persist(); },
  async settings() { return data.meta.settings ? JSON.parse(data.meta.settings) as UserSettings : null; },
  async putSettings(s) { data.meta.settings = JSON.stringify(s); persist(); },
  async enqueue(op) { data.outbox = data.outbox.filter(o => o.opId !== op.opId).concat(op); persist(); },
  async pending(limit) { return data.outbox.slice(0, limit); },
  async ack(ids) { const s = new Set(ids); data.outbox = data.outbox.filter(o => !s.has(o.opId)); persist(); },
  async pendingCount() { return data.outbox.length; },
  async meta(key) { return data.meta[key] ?? null; },
  async setMeta(key, value) { data.meta[key] = value; persist(); },
  async reassignOwner(fromId, toId) {
    for (const g of Object.values(data.goals)) if (g.ownerId === fromId) g.ownerId = toId;
    for (const c of Object.values(data.checkins)) if (c.userId === fromId) c.userId = toId;
    for (const g of Object.values(data.groups)) if (g.ownerId === fromId) g.ownerId = toId;
    persist();
  },
  async wipe() { data = { goals: {}, checkins: {}, groups: {}, outbox: [], meta: {} }; persist(); }
};
