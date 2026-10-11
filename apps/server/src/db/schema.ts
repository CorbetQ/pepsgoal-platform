import { bigint, boolean, date, doublePrecision, index, integer, jsonb, pgEnum, pgSequence, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Schéma PostgreSQL de PepsGoal.
 * Les tables synchronisées (objectifs, validations, groupes) portent une colonne `rev` alimentée par la séquence
 * `sync_rev_seq` : l'app demande « tout ce qui a changé depuis la révision N ». Les suppressions sont « douces »
 * (`deleted_at`) pour pouvoir être transmises aux appareils hors ligne.
 */
export const syncRevSeq = pgSequence('sync_rev_seq');
export const roleEnum = pgEnum('role', ['user', 'admin', 'official']);
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  passwordHash: text('password_hash'),
  role: roleEnum('role').notNull().default('user'),
  avatar: jsonb('avatar').$type<Record<string, unknown>>().notNull().default({}),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  settingsRev: bigint('settings_rev', { mode: 'number' }).notNull().default(0),
  freezes: integer('freezes').notNull().default(0),
  /** Cadeau de bienvenue (5 gels de série à la fin du tutoriel) : accordé une seule fois par compte. */
  welcomeBonusAt: ts('welcome_bonus_at'),
  warnedAt: ts('warned_at'),
  warnReason: text('warn_reason'),
  commentsRestricted: boolean('comments_restricted').notNull().default(false),
  banUntil: ts('ban_until'),
  banPermanent: boolean('ban_permanent').notNull().default(false),
  banReason: text('ban_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at')
}, t => ({ usernameIdx: uniqueIndex('users_username_idx').on(t.username) }));

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  device: text('device').notNull().default(''),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ hashIdx: uniqueIndex('refresh_tokens_hash_idx').on(t.tokenHash) }));

/* ---------- données personnelles synchronisées ---------- */
export const goalGroups = pgTable('goal_groups', {
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('📁'),
  updatedAt: ts('updated_at').notNull(),
  deletedAt: ts('deleted_at'),
  rev: bigint('rev', { mode: 'number' }).notNull()
}, t => ({ revIdx: index('goal_groups_owner_rev_idx').on(t.ownerId, t.rev) }));

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  icon: text('icon').notNull(),
  note: text('note').notNull().default(''),
  visibility: text('visibility').notNull().default('friends'),
  groupId: uuid('group_id'),
  archived: boolean('archived').notNull().default(false),
  completedAt: ts('completed_at'),
  failedAt: ts('failed_at'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  buddyId: uuid('buddy_id').references(() => users.id, { onDelete: 'set null' }),
  buddyVerify: boolean('buddy_verify').notNull().default(false),
  buddyMiss: boolean('buddy_miss').notNull().default(false),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  deletedAt: ts('deleted_at'),
  rev: bigint('rev', { mode: 'number' }).notNull()
}, t => ({ revIdx: index('goals_owner_rev_idx').on(t.ownerId, t.rev) }));

/** Membres d'un défi de groupe ou d'un duel (le créateur y figure aussi). */
export const goalMembers = pgTable('goal_members', {
  goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' })
}, t => ({ pk: primaryKey({ columns: [t.goalId, t.userId] }) }));

export const checkins = pgTable('checkins', {
  id: uuid('id').primaryKey(),
  goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(),
  kind: text('kind').notNull(),
  value: doublePrecision('value').notNull().default(1),
  points: integer('points').notNull().default(0),
  pending: boolean('pending').notNull().default(false),
  taskId: text('task_id'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  deletedAt: ts('deleted_at'),
  rev: bigint('rev', { mode: 'number' }).notNull()
}, t => ({ userRevIdx: index('checkins_user_rev_idx').on(t.userId, t.rev), goalIdx: index('checkins_goal_idx').on(t.goalId) }));

/** Opérations déjà appliquées : rend l'envoi de la file d'attente idempotent. */
export const syncOps = pgTable('sync_ops', {
  opId: uuid('op_id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  appliedAt: ts('applied_at').notNull().defaultNow()
});

/* ---------- social ---------- */
export const friendships = pgTable('friendships', {
  id: uuid('id').primaryKey().defaultRandom(),
  requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addresseeId: uuid('addressee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pairIdx: uniqueIndex('friendships_pair_idx').on(t.requesterId, t.addresseeId) }));

/** Blocage entre utilisateurs (exigé par les stores pour les contenus générés par les utilisateurs). */
export const blocks = pgTable('blocks', {
  blockerId: uuid('blocker_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  blockedId: uuid('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.blockerId, t.blockedId] }) }));

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  visibility: text('visibility').notNull(),
  goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  kind: text('kind').notNull().default('manual'),
  status: text('status').notNull().default('visible'),
  commentsLocked: boolean('comments_locked').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at')
}, t => ({ authorIdx: index('posts_author_idx').on(t.authorId, t.createdAt) }));

export const postLikes = pgTable('post_likes', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.postId, t.userId] }) }));

/** Encouragements comptés pour les gels de série : un seul par personne et par publication, même après un retrait. */
export const cheerCredits = pgTable('cheer_credits', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' })
}, t => ({ pk: primaryKey({ columns: [t.postId, t.userId] }), authorIdx: index('cheer_credits_author_idx').on(t.authorId) }));

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at')
});

export const stories = pgTable('stories', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  mediaUrl: text('media_url'),
  data: jsonb('data').$type<Record<string, unknown>>(),
  text: text('text').notNull().default(''),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull()
});

export const storyViews = pgTable('story_views', {
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  viewerId: uuid('viewer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  seenAt: ts('seen_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.storyId, t.viewerId] }) }));

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  recipientId: uuid('recipient_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Texte en clair : uniquement les messages du compte PepsGoal Officiel. */
  text: text('text'),
  /** Messages entre amis : chiffrés de bout en bout ({ v, keyId, nonce, ct }), illisibles par le serveur. */
  e2e: jsonb('e2e').$type<{ v: number; keyId: string; nonce: string; ct: string }>(),
  official: boolean('official').notNull().default(false),
  tag: text('tag'),
  auto: boolean('auto').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  readAt: ts('read_at')
}, t => ({ convIdx: index('messages_conv_idx').on(t.recipientId, t.senderId, t.createdAt) }));

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  text: text('text').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
  readAt: ts('read_at')
}, t => ({ userIdx: index('notifications_user_idx').on(t.userId, t.createdAt) }));

/* ---------- modération ---------- */
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  closedAt: ts('closed_at')
}, t => ({ uniq: uniqueIndex('reports_unique_idx').on(t.postId, t.reporterId) }));

export const appeals = pgTable('appeals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  status: text('status').notNull().default('pending'),
  answer: text('answer').notNull().default(''),
  createdAt: ts('created_at').notNull().defaultNow(),
  decidedAt: ts('decided_at'),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' })
});

export const modActions = pgTable('mod_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminId: uuid('admin_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
  detail: text('detail').notNull().default(''),
  createdAt: ts('created_at').notNull().defaultNow()
});

export const maintenance = pgTable('maintenance', {
  id: uuid('id').primaryKey().defaultRandom(),
  mode: text('mode').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at'),
  message: text('message').notNull().default(''),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  endedAt: ts('ended_at'),
  createdAt: ts('created_at').notNull().defaultNow()
});

export const announcements = pgTable('announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  text: text('text').notNull(),
  tag: text('tag').notNull(),
  forNewUsers: boolean('for_new_users').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow()
});

/* ---------- chiffrement de bout en bout des messages privés (docs/E2E.md) ---------- */
/** Clé publique X25519 d'un appareil connecté ; la clé secrète reste sur l'appareil. */
export const e2eDevices = pgTable('e2e_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow()
}, t => ({ userIdx: index('e2e_devices_user_idx').on(t.userId) }));

/** Version de clé d'une paire d'amis (user_a < user_b). La clé elle-même n'est jamais stockée en clair. */
export const e2ePairKeys = pgTable('e2e_pair_keys', {
  keyId: uuid('key_id').primaryKey(),
  userA: uuid('user_a').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userB: uuid('user_b').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pairIdx: index('e2e_pair_keys_pair_idx').on(t.userA, t.userB, t.createdAt) }));

/** Clé de paire chiffrée pour un appareil précis (crypto_box). */
export const e2eEnvelopes = pgTable('e2e_envelopes', {
  keyId: uuid('key_id').notNull().references(() => e2ePairKeys.keyId, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => e2eDevices.id, { onDelete: 'cascade' }),
  senderPublicKey: text('sender_public_key').notNull(),
  nonce: text('nonce').notNull(),
  box: text('box').notNull(),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.keyId, t.deviceId] }) }));
