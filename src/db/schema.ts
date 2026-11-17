import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    brightness: integer("brightness").default(50).notNull(),
    modules: jsonb("modules").$type<DashboardModuleConfig[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Reusable defaults are kept separately from configured dashboard instances.
// Removing a module instance never removes its type from this catalog.
export const dashboardModuleCatalog = pgTable("dashboard_module_catalog", {
    moduleType: text("module_type").primaryKey(),
    name: text("name").notNull(),
    template: jsonb("template").$type<DashboardModuleConfig>().notNull(),
    sortOrder: integer("sort_order").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Shared provider cache survives server restarts and avoids repeated quota use.
export const footballCache = pgTable("football_cache", {
    key: text("key").primaryKey(),
    response: jsonb("response").$type<unknown>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Periodic Upstox prices provide the reference point for 5/15-minute momentum.
export const marketIndexSnapshots = pgTable("market_index_snapshots", {
    id: uuid("id").defaultRandom().primaryKey(),
    instrumentKey: text("instrument_key").notNull(),
    price: doublePrecision("price").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
}, (table) => [
    index("market_index_snapshots_instrument_time_idx")
        .on(table.instrumentKey, table.capturedAt),
]);
