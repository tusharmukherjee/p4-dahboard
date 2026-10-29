export interface ModuleContext {
    now: Date;
}

export interface ModuleResult<TData> {
    moduleId: string;
    generatedAt: string;
    data: TData;
    nextState?: Record<string, unknown>;
}

export interface DashboardModule<TConfig, TData> {
    readonly id: string;
    readonly name: string;

    getData(
        config: TConfig,
        context: ModuleContext,
    ): Promise<ModuleResult<TData>>;
}
