import type { Checkin, Goal, GoalGroup, GoalType, PublicUser } from '@pepsgoal/shared';

// Lignes brutes renvoyées par PostgreSQL (colonnes en snake_case)
export type Row = Record<string, any>;

const iso = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).toISOString());

export const toPublicUser = (r: Row): PublicUser => ({
  id: r.id, username: r.username, displayName: r.display_name, avatar: r.avatar ?? {}, role: r.role
});

export const toGoal = (r: Row): Goal => ({
  id: r.id, ownerId: r.owner_id, type: r.type as GoalType, title: r.title, icon: r.icon, note: r.note,
  visibility: r.visibility, groupId: r.group_id, archived: r.archived, completedAt: iso(r.completed_at), failedAt: iso(r.failed_at),
  data: r.data ?? {}, memberIds: r.member_ids ?? [], buddyId: r.buddy_id, buddyVerify: r.buddy_verify, buddyMiss: r.buddy_miss,
  createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!
});

export const toCheckin = (r: Row): Checkin => ({
  id: r.id, goalId: r.goal_id, userId: r.user_id, date: typeof r.date === 'string' ? r.date : iso(r.date)!.slice(0, 10),
  kind: r.kind, value: Number(r.value), points: r.points, pending: r.pending, taskId: r.task_id,
  createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!
});

export const toGoalGroup = (r: Row): GoalGroup => ({ id: r.id, ownerId: r.owner_id, name: r.name, icon: r.icon, updatedAt: iso(r.updated_at)! });

export { iso };
