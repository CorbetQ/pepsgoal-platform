CREATE TABLE IF NOT EXISTS "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '💬' NOT NULL,
	"owner_id" uuid,
	"members_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "e2e_pair_keys" ALTER COLUMN "user_a" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "e2e_pair_keys" ALTER COLUMN "user_b" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "recipient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "e2e_pair_keys" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attachments" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "photo_url" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_group_members" ADD CONSTRAINT "chat_group_members_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_group_members" ADD CONSTRAINT "chat_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_group_members_user_idx" ON "chat_group_members" USING btree ("user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "e2e_pair_keys" ADD CONSTRAINT "e2e_pair_keys_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "e2e_pair_keys_group_idx" ON "e2e_pair_keys" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_group_idx" ON "messages" USING btree ("group_id","created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_target_chk" CHECK (("recipient_id" IS NULL) <> ("group_id" IS NULL));