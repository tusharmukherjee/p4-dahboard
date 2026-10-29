import type { ModuleResult } from "./contracts.js";

export interface ModuleCacheEntry {
    result: ModuleResult<unknown>;
    fetchedAt: number;
    expiresAt: number;
}

export class ModuleDataCache {
    private readonly entries = new Map<string, ModuleCacheEntry>();

    get(key: string): ModuleCacheEntry | undefined {
        return this.entries.get(key);
    }

    set(key: string, result: ModuleResult<unknown>, refreshTime: number): ModuleCacheEntry {
        const fetchedAt = Date.now();
        const entry = {
            result,
            fetchedAt,
            expiresAt: fetchedAt + refreshTime,
        };

        this.entries.set(key, entry);
        return entry;
    }

    delete(key: string): void {
        this.entries.delete(key);
    }

    clear(): void {
        this.entries.clear();
    }
}
