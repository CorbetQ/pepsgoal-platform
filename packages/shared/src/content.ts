import { z } from 'zod';

/*
 * Contenus téléchargeables (packs de thème, fonds, autocollants, icônes) : format partagé par le serveur, la future
 * plateforme de création et l'application Android (même format que l'export d'un pack personnel, `PackFormat.kt`).
 * Voir docs/content-api.md.
 */

/** Version du format d'un pack de thème comprise par ce serveur. */
export const PACK_SCHEMA_VERSION = 1;

export const CONTENT_TYPES = ['theme_pack', 'background', 'sticker_pack', 'icon'] as const;
export const ContentType = z.enum(CONTENT_TYPES);
export type ContentType = z.infer<typeof ContentType>;

/** `pending` : publié par un créateur, en attente de la modération ; `rejected` : refusé (motif dans reviewNote). */
export const CONTENT_STATUSES = ['draft', 'pending', 'published', 'rejected', 'retired'] as const;
export const ContentStatus = z.enum(CONTENT_STATUSES);
export type ContentStatus = z.infer<typeof ContentStatus>;

export const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur attendue au format #RRGGBB').transform(s => s.toUpperCase());
/** Nom d'un fichier joint au contenu (référencé par le JSON du contenu). */
export const ContentFileName = z.string().regex(/^[\w.-]{1,128}$/, 'Nom de fichier : lettres, chiffres, point, tiret').refine(s => !s.includes('..'), 'Nom de fichier invalide');
const Key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Clé attendue : minuscules, chiffres, tirets');

export const PACK_FREE_BGS = ['pop', 'aurora', 'waves', 'stars', 'mesh', 'grid', 'plain'] as const;
export const PACK_FX = ['snow', 'petals', 'leaves', 'hearts', 'embers', 'bubbles', 'confetti', 'stars'] as const;

export const PackColors = z.object({
  bg: Hex, ink: Hex, surface: Hex, surface2: Hex, edge: Hex,
  accent: z.array(Hex).length(3),
  deco: z.array(Hex).min(1).max(4)
});

export const PackWallpaper = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scene'), key: Key }),
  z.object({ kind: z.literal('free'), key: z.enum(PACK_FREE_BGS) }),
  z.object({ kind: z.literal('gradient'), colors: z.array(Hex).min(2).max(4) }),
  // Contenu téléchargé : `file` désigne l'un des fichiers joints (image vérifiée par son sha256).
  // 10.0 « PepsGoal Style » : `foreground` (WebP avec alpha, ciel découpé) laisse passer la météo entre le ciel et le
  // premier plan ; `weather` : adaptation météo voulue par le créateur ; `styled` : image stylisée par le serveur.
  z.object({ kind: z.literal('image'), file: ContentFileName.optional(), foreground: ContentFileName.optional(), weather: z.boolean().optional(), styled: z.boolean().optional() })
]);

/**
 * Pack de thème, version 1. Les champs inconnus sont tolérés (et conservés) : une version mineure peut en ajouter
 * sans casser les applications existantes ; un changement incompatible incrémente `schemaVersion`.
 */
export const ThemePackSchema = z.object({
  schemaVersion: z.literal(PACK_SCHEMA_VERSION),
  type: z.literal('theme_pack'),
  /** Identifiant du pack ; pour un contenu du serveur, remplacé par l'id du contenu à la diffusion. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/).optional(),
  name: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(16).default('🎨'),
  dark: z.boolean().default(false),
  colors: PackColors,
  wallpaper: PackWallpaper.default({ kind: 'free', key: 'pop' }),
  icon: Key.optional(),
  fx: z.enum(PACK_FX).optional(),
  author: z.string().trim().max(60).optional()
}).passthrough();
export type ThemePack = z.infer<typeof ThemePackSchema>;

/** Fond d'écran seul : une image jointe et, au besoin, ses couleurs dominantes. */
export const BackgroundSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('background'),
  file: ContentFileName,
  dark: z.boolean().default(false),
  colors: z.array(Hex).max(6).default([])
}).passthrough();

/** Autocollants et icônes : format encore ouvert (la plateforme de création le précisera), JSON objet versionné. */
const OpenSchema = (type: string) => z.object({ schemaVersion: z.number().int().min(1).max(1), type: z.literal(type) }).passthrough();

export const CONTENT_SCHEMAS = {
  theme_pack: ThemePackSchema,
  background: BackgroundSchema,
  sticker_pack: OpenSchema('sticker_pack'),
  icon: OpenSchema('icon')
} as const;

/** Fichier associé : média public, vérifié par l'application (sha256 en hexadécimal, taille en octets). */
export const ContentFile = z.object({
  name: ContentFileName,
  url: z.string().url().max(500),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 attendu en hexadécimal minuscule'),
  size: z.number().int().min(1).max(15 * 1024 * 1024),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/json']).default('image/jpeg')
});
export type ContentFile = z.infer<typeof ContentFile>;

export const ContentSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'Slug : 2 à 64 caractères, minuscules, chiffres et tirets');

const ContentFields = {
  slug: ContentSlug,
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(400).default(''),
  author: z.string().trim().max(60).default(''),
  price: z.number().int().min(0).max(5000).default(0),
  content: z.record(z.unknown()),
  files: z.array(ContentFile).max(20).default([])
};

/** Valide le JSON d'un contenu selon son type, et vérifie que les fichiers qu'il cite sont joints. */
export function validateContent(type: ContentType, content: unknown, files: { name: string }[]): { ok: true; content: Record<string, unknown> } | { ok: false; issues: string[] } {
  const r = CONTENT_SCHEMAS[type].safeParse(content);
  if (!r.success) return { ok: false, issues: r.error.issues.map(i => `${i.path.join('.') || 'content'} : ${i.message}`) };
  const value = r.data as Record<string, unknown>;
  const names = new Set(files.map(f => f.name));
  const cited: string[] = [];
  if (type === 'theme_pack') {
    const w = (value as ThemePack).wallpaper;
    if (w.kind === 'image') {
      if (!w.file) return { ok: false, issues: ['wallpaper.file : obligatoire pour un contenu du serveur'] };
      cited.push(w.file); if (w.foreground) cited.push(w.foreground);
    }
  }
  if (type === 'background') cited.push(String(value.file));
  const missing = cited.filter(n => !names.has(n));
  if (missing.length) return { ok: false, issues: missing.map(n => `files : fichier « ${n} » cité mais absent`) };
  if (names.size !== files.length) return { ok: false, issues: ['files : noms de fichiers en double'] };
  return { ok: true, content: value };
}

const withContent = <T extends z.ZodTypeAny>(schema: T) => schema.superRefine((b: any, ctx) => {
  if (b.content === undefined || b.type === undefined) return;
  const r = validateContent(b.type, b.content, b.files ?? []);
  if (!r.ok) for (const m of r.issues) ctx.addIssue({ code: 'custom', path: ['content'], message: m });
});

/** Création d'un contenu (brouillon par défaut). */
export const ContentCreateBody = withContent(z.object({ type: ContentType, ...ContentFields, status: z.enum(['draft', 'published']).default('draft') }));
/** Modification : champs fournis seulement ; le type ne change pas. La version augmente à chaque modification. */
export const ContentUpdateBody = z.object({
  slug: ContentSlug.optional(),
  name: ContentFields.name.optional(),
  description: z.string().trim().max(400).optional(),
  author: z.string().trim().max(60).optional(),
  price: z.number().int().min(0).max(5000).optional(),
  content: z.record(z.unknown()).optional(),
  files: z.array(ContentFile).max(20).optional()
}).refine(b => Object.keys(b).length > 0, 'Rien à modifier.');

/** Paramètres du catalogue : `since` (ISO 8601) pour les seuls changements, pagination par `offset` / `limit`. */
export const CatalogQuery = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  type: ContentType.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});

/* ---------------------------------------------------------------- Boutique des créateurs (10.0) */

/** Prix maximal d'un pack publié par un créateur, en flammes. 100 % du prix lui revient. */
export const CREATOR_PRICE_MAX = 5000;
/** Packs publiés (en attente, publiés ou refusés) par créateur au plus. */
export const CREATOR_MAX_ITEMS = 30;

/**
 * Pack publié depuis l'application : un pack de thème (même format que l'export) et ses fichiers, déjà téléversés
 * sur ce serveur (POST /v1/creator/media ou résultat de POST /v1/style). L'auteur est le compte, jamais le corps.
 */
export const CreatorPackBody = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(280).default(''),
  price: z.number().int().min(0).max(CREATOR_PRICE_MAX).default(0),
  content: z.record(z.unknown()),
  files: z.array(ContentFile).max(4).default([])
}).superRefine((b, ctx) => {
  const r = validateContent('theme_pack', b.content, b.files);
  if (!r.ok) for (const m of r.issues) ctx.addIssue({ code: 'custom', path: ['content'], message: m });
});
export type CreatorPackBody = z.infer<typeof CreatorPackBody>;

/** Motif d'un refus de la modération. */
export const ContentRejectBody = z.object({ reason: z.string().trim().min(1).max(200) });

/** Options de « PepsGoal Style » (paramètres de la requête POST /v1/style, la photo étant le fichier envoyé). */
export const StyleQuery = z.object({
  stylize: z.enum(['0', '1', 'true', 'false']).default('1').transform(v => v === '1' || v === 'true'),
  weather: z.enum(['0', '1', 'true', 'false']).default('1').transform(v => v === '1' || v === 'true'),
  strength: z.coerce.number().min(0).max(1).default(.8)
});
