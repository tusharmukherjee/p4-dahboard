CREATE TABLE "football_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"response" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint

-- Add the disabled football module to installations seeded before this feature.
-- Incrementing the version makes the ESP fetch the updated configuration.
UPDATE "dashboard_configurations"
SET "modules" = "modules" || $$[{"moduleId":"football","name":"Football","enabled":false,"duration":10000,"refreshTime":60000,"dataSource":"api","payload":{"competitionCode":"","teamId":0},"display":{"mode":"single","renderer":"football"},"config":{"fixture":{"color":"#FFFFFF","scroll":true},"score":{"color":"#C9FF3D"}}}]$$::jsonb,
    "version" = "version" + 1,
    "updated_at" = now()
WHERE "id" = 'default'
  AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements("modules") AS module
      WHERE module->>'moduleId' = 'football'
  );
