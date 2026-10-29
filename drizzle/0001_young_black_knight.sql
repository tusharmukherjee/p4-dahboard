CREATE TABLE "dashboard_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"modules" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
