CREATE TABLE IF NOT EXISTS "dashboard_module_catalog" (
	"module_type" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"template" jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
