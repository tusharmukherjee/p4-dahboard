import type { DashboardModule, ModuleContext, ModuleResult } from "./contracts.js";

export abstract class BaseModule<TConfig, TData> implements DashboardModule<TConfig, TData> {
    abstract readonly id: string;
    abstract readonly name: string;

    async getData(config: TConfig, context: ModuleContext): Promise<ModuleResult<TData>> {
        return {
            moduleId: this.id,
            generatedAt: context.now.toISOString(),
            data: await this.fetch(config, context),
        }
    }

    protected abstract fetch(
        config: TConfig,
        context: ModuleContext,
    ): Promise <TData>;
}