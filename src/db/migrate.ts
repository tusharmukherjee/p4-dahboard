import "../config/env.js";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { getDatabase } from "./client.js";

// Resolve from this file so the command works regardless of the current folder.
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

await migrate(getDatabase(), { migrationsFolder });

console.log("Database migrations applied successfully.");
