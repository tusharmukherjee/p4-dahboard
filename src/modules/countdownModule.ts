import { BaseModule } from "./baseModule.js";

type CountdownData = Record<string, never>;

export class CountdownModule extends BaseModule<unknown, CountdownData> {
    readonly id = "focus-countdown";
    readonly name = "Focus Countdown";

    protected async fetch(): Promise<CountdownData> {
        // Timing and countdown state are managed locally by the ESP.
        return {};
    }
}
