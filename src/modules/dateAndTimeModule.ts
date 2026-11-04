import { BaseModule } from "./baseModule.js";
import { ModuleContext } from "./contracts.js";

interface DateTimeConfig {
  payload?: {
    latitude?: number;
    longitude?: number;
    timezone?: string;
  };
}

interface DateTimeData {
  date: string;
  time: string;
  temperature: number | null;
  cloudCover: number | null,
  humidity: number | null,
  aqi: number | null
}

interface WeatherData {
  temperature: number;
  cloudCover: number;
  weatherCode: number;
  humidity: number;
}

interface AqiData {
    aqi: number
}

export class DateTimeModule extends BaseModule<DateTimeConfig, DateTimeData> {
    readonly id = "date-and-time";
    readonly name = "Date and Time";

    protected async fetch(
        config: DateTimeConfig,
        context: ModuleContext,
    ) {
        const latitude = config.payload?.latitude ?? 28.9833;
        const longitude = config.payload?.longitude ?? 77.7;
        const timezone = this.validTimezone(config.payload?.timezone);
        const [weather, aqi] = await Promise.all([
            this.fetchWeather(latitude, longitude, timezone).catch((error: unknown) => {
                console.error("Failed to fetch weather from Open-Meteo:", error);
                return null;
            }),
            this.fetchAqi(latitude, longitude, timezone).catch((error: unknown) => {
                console.error("Failed to fetch air quality from Open-Meteo:", error);
                return null;
            }),
        ])
        return {
            // en-US preserves the MM/DD/YYYY format consumed by the ESP while
            // timeZone makes the result independent of the server's timezone.
            date: context.now.toLocaleDateString("en-US", { timeZone: timezone }),
            time: context.now.toLocaleTimeString("en-US", {
                timeZone: timezone,
                hour12: true,
            }),
            temperature: weather?.temperature ?? null,
            cloudCover: weather?.cloudCover ?? null,
            humidity: weather?.humidity ?? null,
            aqi
        }
    }

    private async fetchWeather(
        latitude: number,
        longitude: number,
        timezone: string,
    ): Promise<WeatherData> {
        const query = new URLSearchParams({
            latitude: String(latitude),
            longitude: String(longitude),
            current: "temperature_2m,cloud_cover,weather_code,relative_humidity_2m",
            timezone,
        });
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?${query.toString()}`
        )

        if(!response.ok) {
            throw new Error(
                `Weather API returned ${response.status}`
            );
        }

        const body = await response.json();

        return {
            temperature: body.current.temperature_2m,
            cloudCover: body.current.cloud_cover,
            weatherCode: body.current.weather_code,
            humidity: body.current.relative_humidity_2m,
        };
    }

    private async fetchAqi(
        latitude: number,
        longitude: number,
        timezone: string,
    ): Promise<number> {
        const query = new URLSearchParams({
            latitude: String(latitude),
            longitude: String(longitude),
            current: "us_aqi,pm2_5,pm10",
            timezone,
        });
        const response = await fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?${query.toString()}`,
        );

        if (!response.ok) {
            throw new Error(
                `AQI API returned status ${response.status}`,
            );
        }

        const body = await response.json();

        return body.current.us_aqi
    }

    private validTimezone(value: string | undefined): string {
        const timezone = value?.trim() || "Asia/Kolkata";
        try {
            new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
            return timezone;
        } catch {
            console.warn(`Invalid dashboard timezone '${timezone}', using Asia/Kolkata`);
            return "Asia/Kolkata";
        }
    }
}
