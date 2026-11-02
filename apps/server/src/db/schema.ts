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
  /** Jeton émis en échange de celui-ci (rotation) : sert à reconnaître une réponse perdue d'un vol. */
  replacedBy: uuid('replaced_by'),
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
  /** Photo jointe (image téléversée sur ce serveur, /media/…). */
  photoUrl: text('photo_url'),
  /** Sondage : { multi, endsAt, options: [{ id: 'o0', text }] } ; les votes sont dans poll_votes. */
  poll: jsonb('poll').$type<{ multi: boolean; endsAt: string; options: { id: string; text: string }[] }>(),
  kind: text('kind').notNull().default('manual'),
  status: text('status').notNull().default('visible'),
  commentsLocked: boolean('comments_locked').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at')
}, t => ({ authorIdx: index('posts_author_idx').on(t.authorId, t.createdAt) }));

/** Votes aux sondages du feed : une ligne par option choisie. */
export const pollVotes = pgTable('poll_votes', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  optionId: text('option_id').notNull(),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.postId, t.userId, t.optionId] }) }));

export const postLikes = pgTable('post_likes', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Réaction : fire (défaut), muscle, clap ou party. */
  reaction: text('reaction').notNull().default('fire'),
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

/** Encouragements sur les stories (un par personne et par story). */
export const storyLikes = pgTable('story_likes', {
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.storyId, t.userId] }) }));

/** Abonnements aux notifications push (Web Push) : un par navigateur ; tz sert aux rappels du matin et du soir. */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  tz: text('tz').notNull().default('Europe/Paris'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastOkAt: ts('last_ok_at')
}, t => ({ endpointIdx: uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint), userIdx: index('push_subscriptions_user_idx').on(t.userId) }));

/** Rappels envoyés par le serveur (un de chaque sorte par jour et par compte). */
export const reminderPushes = pgTable('reminder_pushes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  kind: text('kind').notNull(),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.userId, t.day, t.kind] }) }));

/** Réglages internes du serveur (clés VAPID des notifications push, générées au premier démarrage). */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
});

export const storyViews = pgTable('story_views', {
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  viewerId: uuid('viewer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  seenAt: ts('seen_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.storyId, t.viewerId] }) }));

/** Groupe de discussion : messages chiffrés de bout en bout avec une clé propre au groupe (docs/E2E.md). */
export const chatGroups = pgTable('chat_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  emoji: text('emoji').notNull().default('💬'),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  /** Dernier départ d'un membre : les messages suivants doivent utiliser une nouvelle version de clé. */
  membersChangedAt: ts('members_changed_at').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow()
});

export const chatGroupMembers = pgTable('chat_group_members', {
  groupId: uuid('group_id').notNull().references(() => chatGroups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: ts('joined_at').notNull().defaultNow(),
  lastReadAt: ts('last_read_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.groupId, t.userId] }), userIdx: index('chat_group_members_user_idx').on(t.userId) }));

/** Pièce jointe d'un message (photo, message vocal) : fichier chiffré sur l'appareil, opaque pour le serveur. */
export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  size: integer('size').notNull(),
  createdAt: ts('created_at').notNull().defaultNow()
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Message privé : destinataire. Message de groupe : null (voir group_id). */
  recipientId: uuid('recipient_id').references(() => users.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => chatGroups.id, { onDelete: 'cascade' }),
  /** Pièces jointes chiffrées référencées par le message (le serveur ne sait que leur identifiant). */
  attachments: uuid('attachments').array().notNull().default([]),
  /** Texte en clair : uniquement les messages du compte PepsGoal Officiel. */
  text: text('text'),
  /** Messages entre amis : chiffrés de bout en bout ({ v, keyId, nonce, ct }), illisibles par le serveur. */
  e2e: jsonb('e2e').$type<{ v: number; keyId: string; nonce: string; ct: string }>(),
  official: boolean('official').notNull().default(false),
  tag: text('tag'),
  auto: boolean('auto').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  readAt: ts('read_at')
}, t => ({ convIdx: index('messages_conv_idx').on(t.recipientId, t.senderId, t.createdAt), groupIdx: index('messages_group_idx').on(t.groupId, t.createdAt) }));

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

/**
 * Version de clé d'une conversation : paire d'amis (user_a < user_b) ou groupe (group_id).
 * La clé elle-même n'est jamais stockée en clair.
 */
export const e2ePairKeys = pgTable('e2e_pair_keys', {
  keyId: uuid('key_id').primaryKey(),
  userA: uuid('user_a').references(() => users.id, { onDelete: 'cascade' }),
  userB: uuid('user_b').references(() => users.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => chatGroups.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pairIdx: index('e2e_pair_keys_pair_idx').on(t.userA, t.userB, t.createdAt), groupIdx: index('e2e_pair_keys_group_idx').on(t.groupId, t.createdAt) }));

/**
 * Coffre de clés d'un compte : copie de ses clés de conversation, chiffrées sur l'appareil avec une clé dérivée
 * du mot de passe (PBKDF2, sel ci-dessous). Le serveur ne peut pas les ouvrir ; un nouvel appareil les récupère à la connexion.
 */
export const e2eVaults = pgTable('e2e_vaults', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  salt: text('salt').notNull(),
  iterations: integer('iterations').notNull(),
  /** Valeur témoin chiffrée : vérifie que la clé dérivée est la bonne. */
  check: text('check').notNull(),
  /** 1.3.0 : clé du coffre (aléatoire) chiffrée avec la clé dérivée du mot de passe ; null pour les coffres 1.2.0. */
  wrappedKey: text('wrapped_key'),
  /** Témoin chiffré avec la clé du coffre : un appareil vérifie que la clé qu'il garde est toujours la bonne. */
  kcv: text('kcv'),
  updatedAt: ts('updated_at').notNull().defaultNow()
});
export const e2eVaultKeys = pgTable('e2e_vault_keys', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  keyId: uuid('key_id').notNull(),
  nonce: text('nonce').notNull(),
  box: text('box').notNull(),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.userId, t.keyId] }) }));

/** Clé de paire chiffrée pour un appareil précis (crypto_box). */
export const e2eEnvelopes = pgTable('e2e_envelopes', {
  keyId: uuid('key_id').notNull().references(() => e2ePairKeys.keyId, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => e2eDevices.id, { onDelete: 'cascade' }),
  senderPublicKey: text('sender_public_key').notNull(),
  nonce: text('nonce').notNull(),
  box: text('box').notNull(),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.keyId, t.deviceId] }) }));

/* ---------- défis de la communauté ---------- */
/** Défi public (« Octobre sans sucre ») : on le rejoint, on valide chaque jour, classement des participants. */
export const challenges = pgTable('challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  emoji: text('emoji').notNull().default('🏁'),
  description: text('description').notNull().default(''),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at')
}, t => ({ endIdx: index('challenges_ends_idx').on(t.endsOn) }));

export const challengeMembers = pgTable('challenge_members', {
  challengeId: uuid('challenge_id').notNull().references(() => challenges.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: ts('joined_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.challengeId, t.userId] }) }));

/** Jours validés par un participant (un jour = une ligne : validation idempotente, annulable). */
export const challengeDays = pgTable('challenge_days', {
  challengeId: uuid('challenge_id').notNull().references(() => challenges.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  createdAt: ts('created_at').notNull().defaultNow()
}, t => ({ pk: primaryKey({ columns: [t.challengeId, t.userId, t.day] }) }));
