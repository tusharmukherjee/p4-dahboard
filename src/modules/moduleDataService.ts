import type { DashboardModule, ModuleContext, ModuleResult } from "./contracts.js";
import { ModuleDataCache, type ModuleCacheEntry } from "./moduleDataCache.js";

export interface CacheMetadata {
    cached: boolean;
    stale: boolean;
    fetchedAt: string;
    expiresAt: string | null;
}

export interface ModuleDataResponse {
    moduleResult: ModuleResult<unknown>;
    cache: CacheMetadata;
}

export interface ModuleDataOptions {
    refreshTime?: number;
    cacheKey: string;
}

export class ModuleDataService {
    private readonly cache = new ModuleDataCache();
    private readonly inFlight = new Map<string, Promise<ModuleResult<unknown>>>();

    async getData(
        module: DashboardModule<unknown, unknown>,
        config: unknown,
        context: ModuleContext,
        options: ModuleDataOptions,
    ): Promise<ModuleDataResponse> {
        // Missing, zero, or negative refreshTime means "always call the module".
        if (!options.refreshTime || options.refreshTime <= 0) {
            const result = await module.getData(config, context);
            return {
                moduleResult: result,
                cache: {
                    cached: false,
                    stale: false,
                    fetchedAt: result.generatedAt,
                    expiresAt: null,
                },
            };
        }

        const existing = this.cache.get(options.cacheKey);
        if (existing && Date.now() < existing.expiresAt) {
            return this.toResponse(existing, true, false);
        }

        let request = this.inFlight.get(options.cacheKey);
        if (!request) {
            request = module.getData(config, context);
            this.inFlight.set(options.cacheKey, request);
        }

        try {
            const result = await request;
            const entry = this.cache.set(options.cacheKey, result, options.refreshTime);
            return this.toResponse(entry, false, false);
        } catch (error) {
            // Provider failure should not blank the dashboard if older data exists.
            if (existing) {
                return this.toResponse(existing, true, true);
            }
            throw error;
        } finally {
            if (this.inFlight.get(options.cacheKey) === request) {
                this.inFlight.delete(options.cacheKey);
            }
        }
    }

    createCacheKey(moduleId: string, configurationVersion: number, payload: unknown): string {
        return `${configurationVersion}:${moduleId}:${stableStringify(payload)}`;
    }

    clear(): void {
        this.cache.clear();
        this.inFlight.clear();
    }

    private toResponse(
        entry: ModuleCacheEntry,
        cached: boolean,
        stale: boolean,
    ): ModuleDataResponse {
        return {
            moduleResult: entry.result,
            cache: {
                cached,
                stale,
                fetchedAt: new Date(entry.fetchedAt).toISOString(),
                expiresAt: new Date(entry.expiresAt).toISOString(),
            },
        };
    }
}

// JSON.stringify depends on object insertion order. Sorting keys ensures two
// equivalent payloads produce the same cache key.
function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        return `{${Object.keys(object)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "undefined";
}
