CREATE TABLE IF NOT EXISTS "e2e_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "e2e_envelopes" (
	"key_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"sender_public_key" text NOT NULL,
	"nonce" text NOT NULL,
	"box" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "e2e_envelopes_key_id_device_id_pk" PRIMARY KEY("key_id","device_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "e2e_pair_keys" (
	"key_id" uuid PRIMARY KEY NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "e2e" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "e2e_devices" ADD CONSTRAINT "e2e_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "e2e_envelopes" ADD CONSTRAINT "e2e_envelopes_key_id_e2e_pair_keys_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."e2e_pair_keys"("key_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "e2e_envelopes" ADD CONSTRAINT "e2e_envelopes_device_id_e2e_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."e2e_devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "e2e_pair_keys" ADD CONSTRAINT "e2e_pair_keys_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "e2e_pair_keys" ADD CONSTRAINT "e2e_pair_keys_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "e2e_pair_keys" ADD CONSTRAINT "e2e_pair_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "e2e_devices_user_idx" ON "e2e_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "e2e_pair_keys_pair_idx" ON "e2e_pair_keys" USING btree ("user_a","user_b","created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_check" CHECK ("text" IS NOT NULL OR "e2e" IS NOT NULL);
