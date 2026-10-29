import { readFile } from "node:fs/promises";
import type {
    DashboardConfiguration,
    DashboardModuleConfig,
} from "./dashboardConfig.js";

export class DashboardConfigurationRepository {
    constructor(
        private readonly filepath: string,
    ) {}

    async getConfiguration(): Promise<DashboardConfiguration> {
        const contents = await readFile(this.filepath, "utf8");
        const parsed: unknown = JSON.parse(contents);

        if (!isRecord(parsed)) {
            throw new Error("Dashboard configuration must be an object");
        }
        if (!Number.isInteger(parsed.version) || (parsed.version as number) < 0) {
            throw new Error("Configuration version must be a non-negative integer");
        }
        if (!Array.isArray(parsed.modules)) {
            throw new Error("Configuration modules must be an array");
        }

        const moduleIds = new Set<string>();
        const modules = parsed.modules.map((module, index) => {
            const validated = this.validateModule(module, index);
            if (moduleIds.has(validated.moduleId)) {
                throw new Error(`Duplicate moduleId: ${validated.moduleId}`);
            }
            moduleIds.add(validated.moduleId);
            return validated;
        });

        return {
            version: parsed.version as number,
            modules,
        };
    }

    private validateModule(value: unknown, index: number): DashboardModuleConfig {
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
            this.validateStateMapping(value.stateMapping, `${location}.stateMapping`);
        }

        return value as unknown as DashboardModuleConfig;
    }

    private validateStateMapping(value: unknown, location: string): void {
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
