import "../config/env.js";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { getDatabase } from "./client.js";
import { dashboardConfigurations } from "./schema.js";
import { validateDashboardConfiguration } from "../config/dashboardConfigRepository.js";

// Resolve from this file so the command works regardless of the current folder.
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

await migrate(getDatabase(), { migrationsFolder });

// Seed only an empty installation. Later JSON edits never overwrite database
// configuration; use PUT /api/configuration for updates after this point.
const seedPath = fileURLToPath(new URL("../config/dashboardConfigfixed.json", import.meta.url));
const seed = validateDashboardConfiguration(JSON.parse(await readFile(seedPath, "utf8")));
await getDatabase()
    .insert(dashboardConfigurations)
    .values({
        id: "default",
        version: seed.version,
        modules: seed.modules,
    })
    .onConflictDoNothing({ target: dashboardConfigurations.id });

console.log("Database migrations applied successfully.");
