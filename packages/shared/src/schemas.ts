import { z } from 'zod';
import { E2EPayload } from './e2e.js';

/* ---------- valeurs de base ---------- */
export const Id = z.string().uuid();
export const DayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue au format HH:MM');
export const Username = z.string().regex(/^[a-z0-9._]{3,20}$/, "3 à 20 caractères : lettres minuscules, chiffres, point ou tiret bas");
export const Password = z.string().min(8, 'Au moins 8 caractères').max(200);
export const DisplayName = z.string().trim().min(2).max(40);
export const IsoDate = z.string().datetime();

export const GOAL_TYPES = ['routine', 'objective', 'deadline', 'abstinence', 'monthly', 'limit', 'duration', 'measure', 'timed', 'project', 'challenge', 'program', 'group', 'duel'] as const;
export const GoalType = z.enum(GOAL_TYPES);
export type GoalType = z.infer<typeof GoalType>;
/** Types qui nécessitent un compte et une connexion (partagés avec d'autres personnes). */
export const SOCIAL_GOAL_TYPES: readonly GoalType[] = ['group', 'duel'];

export const Visibility = z.enum(['private', 'friends', 'public']);
export type Visibility = z.infer<typeof Visibility>;
export const CheckinKind = z.enum(['done', 'progress', 'relapse', 'use', 'measure']);
export type CheckinKind = z.infer<typeof CheckinKind>;
export const Role = z.enum(['user', 'admin', 'official']);
export type Role = z.infer<typeof Role>;

/* ---------- réglages propres à chaque type d'objectif ---------- */
const days = z.array(z.number().int().min(0).max(6)).max(7);
const unit = z.string().max(20);
const optionalDay = z.union([DayKeySchema, z.literal('')]);

export const GoalDataByType = {
  routine: z.object({ mode: z.enum(['days', 'count']), days, perWeek: z.number().int().min(1).max(7) }),
  objective: z.object({ target: z.number().positive(), unit, endDate: optionalDay.default('') }),
  deadline: z.object({ due: DayKeySchema }),
  abstinence: z.object({ since: DayKeySchema }),
  monthly: z.object({ target: z.number().positive(), unit, cumulate: z.boolean() }),
  limit: z.object({ max: z.number().min(0), unit, period: z.enum(['day', 'week']) }),
  duration: z.object({ minutes: z.number().positive().max(1440) }),
  measure: z.object({ unit, dir: z.enum(['up', 'down']), timeFmt: z.boolean(), target: z.number().nullable() }),
  timed: z.object({ mode: z.enum(['before', 'after', 'notafter']), time: TimeOfDay, days }),
  project: z.object({ due: optionalDay, tasks: z.array(z.object({ id: z.string().min(1).max(64), t: z.string().max(120), done: z.boolean() })).max(200) }),
  challenge: z.object({ length: z.number().int().min(2).max(365), start: DayKeySchema }),
  program: z.object({ unit, base: z.number().positive(), step: z.number(), weeks: z.number().int().min(2).max(52), start: DayKeySchema }),
  group: z.object({ target: z.number().positive(), unit, endDate: optionalDay }),
  duel: z.object({ unit, endDate: DayKeySchema })
} satisfies Record<GoalType, z.ZodTypeAny>;

export function parseGoalData(type: GoalType, data: unknown): Record<string, unknown> {
  return GoalDataByType[type].parse(data) as Record<string, unknown>;
}

/* ---------- entités synchronisées ---------- */
export const GoalSchema = z.object({
  id: Id,
  ownerId: Id,
  type: GoalType,
  title: z.string().trim().min(1).max(80),
  icon: z.string().max(16).default('🎯'),
  note: z.string().max(240).default(''),
  visibility: Visibility.default('friends'),
  groupId: Id.nullable().default(null),
  archived: z.boolean().default(false),
  completedAt: IsoDate.nullable().default(null),
  failedAt: IsoDate.nullable().default(null),
  data: z.record(z.unknown()),
  memberIds: z.array(Id).max(20).default([]),
  buddyId: Id.nullable().default(null),
  buddyVerify: z.boolean().default(false),
  buddyMiss: z.boolean().default(false),
  createdAt: IsoDate,
  updatedAt: IsoDate
});
export type Goal = z.infer<typeof GoalSchema>;

export const CheckinSchema = z.object({
  id: Id,
  goalId: Id,
  userId: Id,
  date: DayKeySchema,
  kind: CheckinKind,
  value: z.number().finite(),
  points: z.number().int().min(0).max(500),
  pending: z.boolean().default(false),
  taskId: z.string().max(64).nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate
});
export type Checkin = z.infer<typeof CheckinSchema>;

export const GoalGroupSchema = z.object({
  id: Id,
  ownerId: Id,
  name: z.string().trim().min(1).max(30),
  icon: z.string().max(8).default('📁'),
  updatedAt: IsoDate
});
export type GoalGroup = z.infer<typeof GoalGroupSchema>;

export const UserSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  accent: z.number().int().min(0).max(31).default(0),
  social: z.boolean().default(true),
  defaultVisibility: Visibility.default('friends'),
  morning: z.object({ on: z.boolean(), time: TimeOfDay }).default({ on: true, time: '08:30' }),
  evening: z.object({ on: z.boolean(), time: TimeOfDay }).default({ on: true, time: '20:30' }),
  updatedAt: IsoDate.optional()
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

/* ---------- comptes ---------- */
export const RegisterBody = z.object({ username: Username, displayName: DisplayName, password: Password, acceptTerms: z.literal(true) });
export const LoginBody = z.object({ username: z.string().min(1).max(40), password: z.string().min(1).max(200) });
export const PublicUser = z.object({ id: Id, username: z.string(), displayName: z.string(), avatar: z.record(z.unknown()), role: Role });
export type PublicUser = z.infer<typeof PublicUser>;

/* ---------- social ---------- */
export const PostBody = z.object({ text: z.string().trim().min(1).max(500), visibility: z.enum(['friends', 'public']), goalId: Id.nullable().default(null) });
export const CommentBody = z.object({ text: z.string().trim().min(1).max(280) });
/** Messages privés : uniquement chiffrés de bout en bout (voir e2e.ts). */
export const MessageBody = z.object({ e2e: E2EPayload });
export const ReportBody = z.object({ reason: z.enum(['spam', 'hate', 'harass', 'other']) });
export const StoryBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('photo'), mediaUrl: z.string().url().max(500), text: z.string().max(140).default('') }),
  z.object({ kind: z.literal('recap'), data: z.object({ title: z.string().max(30), n: z.number(), pts: z.number(), best: z.number(), reg: z.number(), persona: z.string().max(30), e: z.string().max(8) }), text: z.string().max(140).default('') }),
  z.object({ kind: z.literal('progress'), data: z.object({ type: GoalType, icon: z.string().max(16), title: z.string().max(80), v: z.string().max(24), l: z.string().max(60), label: z.string().max(30), meta: z.string().max(140), pct: z.number().min(0).max(1).nullable() }), text: z.string().max(140).default('') })
]);

/* ---------- modération ---------- */
export const BanBody = z.object({ days: z.union([z.literal(1), z.literal(7), z.literal(30)]).nullable(), reason: z.string().max(160).default('') });
export const ReasonBody = z.object({ reason: z.string().max(160).default('') });
export const AppealBody = z.object({ text: z.string().trim().min(10).max(500) });
export const AppealDecisionBody = z.object({ answer: z.string().max(200).default('') });
export const MaintenanceBody = z.object({ mode: z.enum(['social', 'full']), startsAt: IsoDate, endsAt: IsoDate.nullable(), message: z.string().max(200).default(''), notify: z.boolean().default(true) });
export const AnnouncementBody = z.object({ text: z.string().trim().min(1).max(600), tag: z.enum(['news', 'mod', 'info']), toUserId: Id.nullable().default(null) });

/** Points attribués par le serveur selon le type d'objectif (identiques à l'application). */
export const POINTS: Record<GoalType, number> = {
  routine: 10, objective: 15, deadline: 40, abstinence: 8, monthly: 15, limit: 8, duration: 12, measure: 10,
  timed: 10, project: 10, challenge: 10, program: 10, group: 10, duel: 10
};
