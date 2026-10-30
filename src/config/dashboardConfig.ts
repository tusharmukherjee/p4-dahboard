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
  /** Use "configuration" when the ESP should render staticData without calling the module API. */
  dataSource?: "api" | "configuration";
  staticData?: Record<string, unknown>;
  refreshTime?: number;
  city?: string;
  payload?: Record<string, unknown>;
  display?: DashboardDisplayConfig;
  stateMapping?: Record<string, DashboardStateMappingEntry>;
  config: Record<string, unknown>;
}

export interface DashboardConfiguration {
  version: number;
  brightness: number;
  modules: DashboardModuleConfig[];
}
