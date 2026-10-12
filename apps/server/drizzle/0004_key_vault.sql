CREATE TABLE IF NOT EXISTS "e2e_vault_keys" (
	"user_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"box" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "e2e_vault_keys_user_id_key_id_pk" PRIMARY KEY("user_id","key_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "e2e_vaults" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"iterations" integer NOT NULL,
	"check" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "e2e_vault_keys" ADD CONSTRAINT "e2e_vault_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "e2e_vaults" ADD CONSTRAINT "e2e_vaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
