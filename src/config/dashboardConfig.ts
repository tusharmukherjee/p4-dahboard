export interface DashboardDisplayConfig {
  mode: string;
  renderer: string;
  order?: string;
  [key: string]: unknown;
}

export interface DashboardStateMappingEntry {
  responsePath: string;
  requestPath: string;
  defaultValue: unknown;
}

export interface DashboardModuleConfig {
  moduleId: string;
  name: string;
  duration: number;
  enabled: boolean;
  refreshTime?: number;
  city?: string;
  payload?: Record<string, unknown>;
  display?: DashboardDisplayConfig;
  stateMapping?: Record<string, DashboardStateMappingEntry>;
  config: Record<string, unknown>;
}

export interface DashboardConfiguration {
  version: number;
  modules: DashboardModuleConfig[];
}
