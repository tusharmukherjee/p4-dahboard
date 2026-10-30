import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { dashboardConfigurations } from "../db/schema.js";
import type {
    DashboardConfiguration,
    DashboardModuleConfig,
} from "./dashboardConfig.js";

const DEFAULT_CONFIGURATION_ID = "default";

export class DashboardConfigurationRepository {
    async getConfiguration(): Promise<DashboardConfiguration> {
        const [row] = await getDatabase()
            .select({
                version: dashboardConfigurations.version,
                brightness: dashboardConfigurations.brightness,
                modules: dashboardConfigurations.modules,
            })
            .from(dashboardConfigurations)
            .where(eq(dashboardConfigurations.id, DEFAULT_CONFIGURATION_ID))
            .limit(1);

        if (!row) {
            throw new Error("Dashboard configuration is not initialized; run npm run db:migrate");
        }

        return validateDashboardConfiguration(row);
    }

    async updateConfiguration(
        modules: unknown,
        brightness: unknown,
        expectedVersion: number,
    ): Promise<DashboardConfiguration | null> {
        const validated = validateDashboardConfiguration({
            version: expectedVersion,
            brightness,
            modules,
        });

        const [updated] = await getDatabase()
            .update(dashboardConfigurations)
            .set({
                modules: validated.modules,
                brightness: validated.brightness,
                version: sql`${dashboardConfigurations.version} + 1`,
                updatedAt: new Date(),
            })
            .where(and(
                eq(dashboardConfigurations.id, DEFAULT_CONFIGURATION_ID),
                eq(dashboardConfigurations.version, expectedVersion),
            ))
            .returning({
                version: dashboardConfigurations.version,
                brightness: dashboardConfigurations.brightness,
                modules: dashboardConfigurations.modules,
            });

        return updated ? validateDashboardConfiguration(updated) : null;
    }
}

export function validateDashboardConfiguration(value: unknown): DashboardConfiguration {
    if (!isRecord(value)) {
        throw new Error("Dashboard configuration must be an object");
    }
    if (!Number.isInteger(value.version) || (value.version as number) < 0) {
        throw new Error("Configuration version must be a non-negative integer");
    }
    if (!Number.isInteger(value.brightness) || (value.brightness as number) < 0 || (value.brightness as number) > 100) {
        throw new Error("Configuration brightness must be an integer from 0 to 100");
    }
    if (!Array.isArray(value.modules)) {
        throw new Error("Configuration modules must be an array");
    }

    const moduleIds = new Set<string>();
    const modules = value.modules.map((module, index) => {
        const validated = validateModule(module, index);
        if (moduleIds.has(validated.moduleId)) {
            throw new Error(`Duplicate moduleId: ${validated.moduleId}`);
        }
        moduleIds.add(validated.moduleId);
        return validated;
    });

    return {
        version: value.version as number,
        brightness: value.brightness as number,
        modules,
    };
}

function validateModule(value: unknown, index: number): DashboardModuleConfig {
    const location = `modules[${index}]`;
    if (!isRecord(value)) {
        throw new Error(`${location} must be an object`);
    }

    requireNonEmptyString(value.moduleId, `${location}.moduleId`);
    requireNonEmptyString(value.name, `${location}.name`);
    requirePositiveNumber(value.duration, `${location}.duration`);
    if (typeof value.enabled !== "boolean") {
        throw new Error(`${location}.enabled must be a boolean`);
    }
    if (value.dataSource !== undefined && value.dataSource !== "api" && value.dataSource !== "configuration") {
        throw new Error(`${location}.dataSource must be either api or configuration`);
    }
    if (value.staticData !== undefined && !isRecord(value.staticData)) {
        throw new Error(`${location}.staticData must be an object`);
    }
    if (value.dataSource === "configuration" && !isRecord(value.staticData)) {
        throw new Error(`${location}.staticData is required when dataSource is configuration`);
    }
    if (value.refreshTime !== undefined) {
        requirePositiveNumber(value.refreshTime, `${location}.refreshTime`);
    }
    if (value.city !== undefined) {
        requireNonEmptyString(value.city, `${location}.city`);
    }
    if (value.payload !== undefined && !isRecord(value.payload)) {
        throw new Error(`${location}.payload must be an object`);
    }
    if (!isRecord(value.config)) {
        throw new Error(`${location}.config must be an object`);
    }

    if (value.display !== undefined) {
        if (!isRecord(value.display)) {
            throw new Error(`${location}.display must be an object`);
        }
        requireNonEmptyString(value.display.mode, `${location}.display.mode`);
        requireNonEmptyString(value.display.renderer, `${location}.display.renderer`);
        if (value.display.order !== undefined) {
            requireNonEmptyString(value.display.order, `${location}.display.order`);
        }
    }

    if (value.stateMapping !== undefined) {
        validateStateMapping(value.stateMapping, `${location}.stateMapping`);
    }

    return value as unknown as DashboardModuleConfig;
}

function validateStateMapping(value: unknown, location: string): void {
    if (!isRecord(value)) {
        throw new Error(`${location} must be an object`);
    }

    for (const [stateName, mapping] of Object.entries(value)) {
        const mappingLocation = `${location}.${stateName}`;
        if (!isRecord(mapping)) {
            throw new Error(`${mappingLocation} must be an object`);
        }
        requireNonEmptyString(mapping.responsePath, `${mappingLocation}.responsePath`);
        requireNonEmptyString(mapping.requestPath, `${mappingLocation}.requestPath`);
        if (!("defaultValue" in mapping)) {
            throw new Error(`${mappingLocation}.defaultValue is required`);
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, location: string): asserts value is string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${location} must be a non-empty string`);
    }
}

function requirePositiveNumber(value: unknown, location: string): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${location} must be a positive number`);
    }
}
