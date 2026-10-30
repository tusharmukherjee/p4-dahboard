ALTER TABLE "dashboard_configurations"
ADD COLUMN IF NOT EXISTS "brightness" integer DEFAULT 50 NOT NULL;
