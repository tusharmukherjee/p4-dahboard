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

export type DashboardScheduleDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DashboardAnimationId =
  | "asteroid-earth"
  | "aquarium"
  | "campfire"
  | "cat-and-fly"
  | "dragon-eye"
  | "earth-and-sun"
  | "messi-barca"
  | "moon-stars"
  | "moving-car"
  | "moving-stars"
  | "sleepy-cat"
  | "solar-system";

export interface DashboardScheduleConfig {
  enabled: boolean;
  startTime: string;
  endTime: string;
  timezone: string;
  days: DashboardScheduleDay[];
}

export interface DashboardModuleConfig {
  moduleId: string;
  name: string;
  duration: number;
  enabled: boolean;
  /** Use "configuration" when the ESP should render staticData without calling the module API. */
  dataSource?: "api" | "configuration";
  staticData?: Record<string, unknown>;
  schedule?: DashboardScheduleConfig;
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
