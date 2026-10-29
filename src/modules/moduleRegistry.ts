import { DashboardModule } from "./contracts.js";

export class ModuleRegistry {
    private readonly modules = new Map<string, DashboardModule<unknown, unknown>>();

    register<TConfig, TData>(module: DashboardModule<TConfig, TData>): void {
        if(this.modules.has(module.id)) {
            throw new Error(`Module ${module.id} is already registered`);
        }

        this.modules.set(
            module.id,
            module as DashboardModule<unknown, unknown>
        )
    }

    get(id: string): DashboardModule<unknown, unknown> | undefined {
        return this.modules.get(id);
    }

    list(): DashboardModule<unknown, unknown>[] {
        return [...this.modules.values()]
    }
}