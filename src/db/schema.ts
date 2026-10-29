import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { DashboardModuleConfig } from "../config/dashboardConfig.js";

// One row represents a person allowed to call the protected API.
export const systemUsers = pgTable("system_users", {
    id: uuid("id").defaultRandom().primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// The provider is a string so Google can be added later without a schema change.
export const oauthTokens = pgTable("oauth_tokens", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
        .notNull()
        .references(() => systemUsers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    scopes: text("scopes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex("oauth_tokens_user_provider_unique").on(table.userId, table.provider),
]);

// A JSONB array keeps module-specific payloads flexible while version remains
// a normal column for fast ESP configuration checks.
export const dashboardConfigurations = pgTable("dashboard_configurations", {
    id: text("id").primaryKey(),
    version: integer("version").notNull(),
    modules: jsonb("modules").$type<DashboardModuleConfig[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
