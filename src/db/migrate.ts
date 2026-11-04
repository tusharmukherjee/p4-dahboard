import "../config/env.js";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { getDatabase } from "./client.js";
import { dashboardConfigurations, dashboardModuleCatalog } from "./schema.js";
import { validateDashboardConfiguration } from "../config/dashboardConfigRepository.js";

// Resolve from this file so the command works regardless of the current folder.
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

await migrate(getDatabase(), { migrationsFolder });

// Seed only an empty installation. Later JSON edits never overwrite database
// configuration; use PUT /api/configuration for updates after this point.
const seedPath = fileURLToPath(new URL("../../src/config/dashboardConfigfixed.json", import.meta.url));
const seed = validateDashboardConfiguration(JSON.parse(await readFile(seedPath, "utf8")));
await getDatabase()
    .insert(dashboardConfigurations)
    .values({
        id: "default",
        version: seed.version,
        brightness: seed.brightness,
        modules: seed.modules,
    })
    .onConflictDoNothing({ target: dashboardConfigurations.id });

// Refresh reusable module defaults without touching configured instances.
for (const [sortOrder, module] of seed.modules.entries()) {
    const moduleType = module.moduleType ?? module.moduleId;
    const template = { ...module, moduleId: moduleType, moduleType, enabled: false };
    await getDatabase()
        .insert(dashboardModuleCatalog)
        .values({ moduleType, name: module.name, template, sortOrder })
        .onConflictDoUpdate({
            target: dashboardModuleCatalog.moduleType,
            set: { name: module.name, template, sortOrder, updatedAt: new Date() },
        });
}

console.log("Database migrations applied successfully.");
