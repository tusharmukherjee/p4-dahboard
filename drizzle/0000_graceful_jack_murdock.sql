CREATE TABLE "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"scopes" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_user_provider_unique" ON "oauth_tokens" USING btree ("user_id","provider");