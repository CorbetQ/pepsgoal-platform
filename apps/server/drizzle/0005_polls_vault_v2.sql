CREATE TABLE IF NOT EXISTS "poll_votes" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_post_id_user_id_option_id_pk" PRIMARY KEY("post_id","user_id","option_id")
);
--> statement-breakpoint
ALTER TABLE "e2e_vaults" ADD COLUMN "wrapped_key" text;--> statement-breakpoint
ALTER TABLE "e2e_vaults" ADD COLUMN "kcv" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "poll" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
