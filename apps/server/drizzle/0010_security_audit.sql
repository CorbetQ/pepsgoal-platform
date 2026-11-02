CREATE TABLE IF NOT EXISTS "goal_revocations" (
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"rev" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_revocations_user_id_goal_id_pk" PRIMARY KEY("user_id","goal_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "family_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_revocations" ADD CONSTRAINT "goal_revocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_revocations" ADD CONSTRAINT "goal_revocations_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_revocations_rev_idx" ON "goal_revocations" USING btree ("user_id","rev");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_name_idx" ON "media" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_owner_idx" ON "media" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_attachments_idx" ON "messages" USING gin ("attachments");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
-- Sessions existantes : chaque jeton forme sa propre session
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;--> statement-breakpoint
-- Images déjà en ligne : rattachées au compte qui les utilise (photo de profil, publication, story) ; taille relevée au démarrage
INSERT INTO "media" ("owner_id", "name", "attached_at")
SELECT DISTINCT ON ("name") "owner_id", "name", now() FROM (
  SELECT "id" AS "owner_id", substring("avatar"->>'photoUrl' from '/media/([A-Za-z0-9_-]+\.(?:jpg|png|webp))$') AS "name", 1 AS "o" FROM "users"
  UNION ALL SELECT "author_id", substring("photo_url" from '/media/([A-Za-z0-9_-]+\.(?:jpg|png|webp))$'), 2 FROM "posts"
  UNION ALL SELECT "author_id", substring("media_url" from '/media/([A-Za-z0-9_-]+\.(?:jpg|png|webp))$'), 3 FROM "stories"
) "r" WHERE "name" IS NOT NULL ORDER BY "name", "o"
ON CONFLICT ("name") DO NOTHING;
