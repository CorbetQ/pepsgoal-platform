import * as SQLite from 'expo-sqlite';
import type { Checkin, Goal, GoalGroup, SyncOp, UserSettings } from '@pepsgoal/shared';
import type { LocalStore } from './types';

// iOS / Android : base SQLite. Chaque entité est stockée en JSON avec quelques colonnes indexées.
let db: SQLite.SQLiteDatabase | null = null;
const conn = () => { if (!db) throw new Error('Base locale non initialisée'); return db; };
const parse = <T>(rows: { json: string }[]) => rows.map(r => JSON.parse(r.json) as T);

export const store: LocalStore = {
  async init() {
    db = await SQLite.openDatabaseAsync('pepsgoal.db');
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, owner_id TEXT, updated_at TEXT, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, goal_id TEXT, user_id TEXT, date TEXT, updated_at TEXT, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS checkins_date ON checkins(date);
      CREATE TABLE IF NOT EXISTS goal_groups (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (op_id TEXT PRIMARY KEY, created_at INTEGER, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`);
  },
  async goals() { return parse<Goal>(await conn().getAllAsync('SELECT json FROM goals')); },
  async putGoal(g) { await conn().runAsync('INSERT OR REPLACE INTO goals (id, owner_id, updated_at, json) VALUES (?, ?, ?, ?)', g.id, g.ownerId, g.updatedAt, JSON.stringify(g)); },
  async removeGoal(id) { await conn().runAsync('DELETE FROM goals WHERE id = ?', id); await conn().runAsync('DELETE FROM checkins WHERE goal_id = ?', id); },
  async checkins(fromDate) {
    return parse<Checkin>(fromDate ? await conn().getAllAsync('SELECT json FROM checkins WHERE date >= ?', fromDate) : await conn().getAllAsync('SELECT json FROM checkins'));
  },
  async putCheckin(c) { await conn().runAsync('INSERT OR REPLACE INTO checkins (id, goal_id, user_id, date, updated_at, json) VALUES (?, ?, ?, ?, ?, ?)', c.id, c.goalId, c.userId, c.date, c.updatedAt, JSON.stringify(c)); },
  async removeCheckin(id) { await conn().runAsync('DELETE FROM checkins WHERE id = ?', id); },
  async groups() { return parse<GoalGroup>(await conn().getAllAsync('SELECT json FROM goal_groups')); },
  async putGroup(g) { await conn().runAsync('INSERT OR REPLACE INTO goal_groups (id, json) VALUES (?, ?)', g.id, JSON.stringify(g)); },
  async removeGroup(id) { await conn().runAsync('DELETE FROM goal_groups WHERE id = ?', id); },
  async settings() { const v = await this.meta('settings'); return v ? JSON.parse(v) as UserSettings : null; },
  async putSettings(s) { await this.setMeta('settings', JSON.stringify(s)); },
  async enqueue(op: SyncOp) { await conn().runAsync('INSERT OR REPLACE INTO outbox (op_id, created_at, json) VALUES (?, ?, ?)', op.opId, Date.now(), JSON.stringify(op)); },
  async pending(limit) { return parse<SyncOp>(await conn().getAllAsync('SELECT json FROM outbox ORDER BY created_at LIMIT ?', limit)); },
  async ack(ids) { for (const id of ids) await conn().runAsync('DELETE FROM outbox WHERE op_id = ?', id); },
  async pendingCount() { return (await conn().getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox'))?.n ?? 0; },
  async meta(key) { return (await conn().getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key))?.value ?? null; },
  async setMeta(key, value) { await conn().runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value); },
  async reassignOwner(fromId, toId) {
    for (const g of await this.goals()) if (g.ownerId === fromId) await this.putGoal({ ...g, ownerId: toId });
    for (const c of await this.checkins()) if (c.userId === fromId) await this.putCheckin({ ...c, userId: toId });
    for (const gg of await this.groups()) if (gg.ownerId === fromId) await this.putGroup({ ...gg, ownerId: toId });
  },
  async wipe() { await conn().execAsync('DELETE FROM goals; DELETE FROM checkins; DELETE FROM goal_groups; DELETE FROM outbox; DELETE FROM meta;'); }
};
