ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "replaced_by" uuid;
