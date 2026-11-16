-- Make market breadth available to both existing dashboards and the module picker.
INSERT INTO "dashboard_module_catalog" ("module_type", "name", "template", "sort_order")
VALUES (
    'market-breadth',
    'Market Breadth',
    $$
    {
      "moduleId":"market-breadth",
      "moduleType":"market-breadth",
      "name":"Market Breadth",
      "enabled":false,
      "duration":10000,
      "refreshTime":60000,
      "dataSource":"api",
      "payload":{"indices":["NIFTY 50"]},
      "display":{"mode":"single","renderer":"market-breadth","order":"sequential"},
      "config":{"advancing":{"color":"#28A86B"},"declining":{"color":"#F04444"},"unchanged":{"color":"#FFFFFF"},"indices":{"scroll":true}}
    }
    $$::jsonb,
    80
)
ON CONFLICT ("module_type") DO UPDATE
SET "name" = EXCLUDED."name", "template" = EXCLUDED."template", "sort_order" = EXCLUDED."sort_order", "updated_at" = now();
--> statement-breakpoint

UPDATE "dashboard_configurations"
SET "modules" = "modules" || $$
    [{"moduleId":"market-breadth","moduleType":"market-breadth","name":"Market Breadth","enabled":false,"duration":10000,"refreshTime":60000,"dataSource":"api","payload":{"indices":["NIFTY 50"]},"display":{"mode":"single","renderer":"market-breadth","order":"sequential"},"config":{"advancing":{"color":"#28A86B"},"declining":{"color":"#F04444"},"unchanged":{"color":"#FFFFFF"},"indices":{"scroll":true}}}]
    $$::jsonb,
    "version" = "version" + 1,
    "updated_at" = now()
WHERE "id" = 'default'
  AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements("modules") AS module
      WHERE module->>'moduleId' = 'market-breadth'
  );
