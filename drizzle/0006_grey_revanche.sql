CREATE TABLE "market_index_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_key" text NOT NULL,
	"price" double precision NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "market_index_snapshots_instrument_time_idx" ON "market_index_snapshots" USING btree ("instrument_key","captured_at");
--> statement-breakpoint

UPDATE "dashboard_module_catalog"
SET "name" = 'Market Insights',
    "template" = $$
    {
      "moduleId":"market-breadth",
      "moduleType":"market-breadth",
      "name":"Market Insights",
      "enabled":false,
      "duration":16000,
      "refreshTime":60000,
      "dataSource":"api",
      "payload":{"instrumentKeys":["NSE_INDEX|Nifty 50","NSE_INDEX|Nifty Bank","NSE_INDEX|India VIX"],"momentumMinutes":5},
      "display":{"mode":"single","renderer":"market-breadth","order":"sequential"},
      "config":{"positive":{"color":"#28A86B"},"negative":{"color":"#F04444"},"neutral":{"color":"#FFFFFF"}}
    }
    $$::jsonb,
    "updated_at" = now()
WHERE "module_type" = 'market-breadth';
--> statement-breakpoint

UPDATE "dashboard_configurations"
SET "modules" = (
      SELECT jsonb_agg(
        CASE WHEN module->>'moduleType' = 'market-breadth' OR module->>'moduleId' = 'market-breadth'
          THEN (module - 'payload' - 'name' - 'duration' - 'config') ||
            $$
            {"name":"Market Insights","duration":16000,"payload":{"instrumentKeys":["NSE_INDEX|Nifty 50","NSE_INDEX|Nifty Bank","NSE_INDEX|India VIX"],"momentumMinutes":5},"config":{"positive":{"color":"#28A86B"},"negative":{"color":"#F04444"},"neutral":{"color":"#FFFFFF"}}}
            $$::jsonb
          ELSE module
        END ORDER BY ordinal
      )
      FROM jsonb_array_elements("modules") WITH ORDINALITY AS entries(module, ordinal)
    ),
    "version" = "version" + 1,
    "updated_at" = now()
WHERE "id" = 'default'
  AND EXISTS (
      SELECT 1 FROM jsonb_array_elements("modules") AS module
      WHERE module->>'moduleType' = 'market-breadth' OR module->>'moduleId' = 'market-breadth'
  );
