import { BaseModule } from "./baseModule.js";
import { ModuleContext } from "./contracts.js";

interface DateTimeConfig {
  city: string;
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
        const [weather, aqi] = await Promise.all([
            this.fetchWeather(config.city).catch(() => null),
            this.fetchAqi(config.city).catch(() => null),
        ])
        return {
            date: context.now.toLocaleDateString(),
            time: context.now.toLocaleTimeString(),
            temperature: weather?.temperature ?? null,
            cloudCover: weather?.cloudCover ?? null,
            humidity: weather?.humidity ?? null,
            aqi
        }
    }

    private async fetchWeather(city: string): Promise<WeatherData> {
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=28.9833&longitude=77.7&current=temperature_2m,cloud_cover,weather_code,relative_humidity_2m&timezone=Asia/Kolkata`
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
        city: string,
    ): Promise<number> {
        const response = await fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=28.9833&longitude=77.7&current=us_aqi,pm2_5,pm10&timezone=Asia/Kolkata`,
        );

        if (!response.ok) {
            throw new Error(
                `AQI API returned status ${response.status}`,
            );
        }

        const body = await response.json();

        return body.current.us_aqi
    }
}