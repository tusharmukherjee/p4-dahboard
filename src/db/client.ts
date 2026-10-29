import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

let database: ReturnType<typeof createDatabase> | null = null;

function createDatabase() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is not configured");
    }

    // Neon HTTP is a good fit here because every repository operation is a
    // small, independent query and does not require a long-lived connection.
    return drizzle(databaseUrl, { schema });
}

export function getDatabase() {
    database ??= createDatabase();
    return database;
}
