ALTER TABLE "post_likes" ADD COLUMN IF NOT EXISTS "reaction" text DEFAULT 'fire' NOT NULL;
