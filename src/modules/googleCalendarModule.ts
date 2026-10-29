import { BaseModule } from "./baseModule.js";
import type { ModuleContext } from "./contracts.js";
import type { GoogleOAuth } from "../oauth/googleOAuth.js";

interface GoogleCalendarConfig {
    payload?: {
        calendarId?: string;
        timeZone?: string;
        maxResults?: number;
    };
}

interface GoogleEventDate {
    date?: string;
    dateTime?: string;
}

interface GoogleEventResponse {
    id?: string;
    summary?: string;
    location?: string;
    htmlLink?: string;
    start?: GoogleEventDate;
    end?: GoogleEventDate;
}

interface GoogleEventsResponse {
    items?: GoogleEventResponse[];
    error?: { message?: string };
}

interface CalendarEvent {
    id: string;
    title: string;
    start: string;
    end: string;
    startTime: string;
    endTime: string;
    allDay: boolean;
    location: string | null;
    url: string | null;
    status: "past" | "ongoing" | "upcoming";
}

interface GoogleCalendarData {
    date: string;
    timeZone: string;
    ongoingEvents: CalendarEvent[];
    upcomingEvents: CalendarEvent[];
}

export class GoogleCalendarModule extends BaseModule<GoogleCalendarConfig, GoogleCalendarData> {
    readonly id = "google-calendar";
    readonly name = "Google Calendar";

    constructor(private readonly googleOAuth: GoogleOAuth) {
        super();
    }

    protected async fetch(
        config: GoogleCalendarConfig,
        context: ModuleContext,
    ): Promise<GoogleCalendarData> {
        const calendarId = config.payload?.calendarId ?? "primary";
        const timeZone = config.payload?.timeZone ?? "Asia/Kolkata";
        const maxResults = this.getMaxResults(config.payload?.maxResults);
        const day = this.getLocalDay(context.now, timeZone);
        const timeMin = this.toZonedMidnight(day.year, day.month, day.day, timeZone);
        const timeMax = this.toZonedMidnight(day.year, day.month, day.day + 1, timeZone);

        let accessToken = await this.googleOAuth.getAccessToken();
        let response = await this.fetchEvents(
            calendarId,
            timeZone,
            maxResults,
            timeMin,
            timeMax,
            accessToken,
        );

        if (response.status === 401) {
            accessToken = await this.googleOAuth.getAccessToken(true);
            response = await this.fetchEvents(
                calendarId,
                timeZone,
                maxResults,
                timeMin,
                timeMax,
                accessToken,
            );
        }

        const body = await response.json() as GoogleEventsResponse;
        if (!response.ok) {
            throw new Error(
                `Google Calendar API returned ${response.status}: ${body.error?.message ?? "Unknown error"}`,
            );
        }

        const events = (body.items ?? [])
            .map((event) => this.mapEvent(event, context.now, timeZone))
            .filter((event): event is CalendarEvent => event !== null);

        return {
            date: `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`,
            timeZone,
            ongoingEvents: events
                .filter((event) => event.status === "ongoing")
                .sort((left, right) => left.start.localeCompare(right.start)),
            upcomingEvents: events
                .filter((event) => event.status === "upcoming")
                .sort((left, right) => left.start.localeCompare(right.start)),
        };
    }

    private fetchEvents(
        calendarId: string,
        timeZone: string,
        maxResults: number,
        timeMin: Date,
        timeMax: Date,
        accessToken: string,
    ): Promise<Response> {
        const query = new URLSearchParams({
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            timeZone,
            singleEvents: "true",
            orderBy: "startTime",
            maxResults: String(maxResults),
        });

        return fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
        );
    }

    private mapEvent(
        event: GoogleEventResponse,
        now: Date,
        timeZone: string,
    ): CalendarEvent | null {
        const start = this.parseEventDate(event.start, timeZone);
        const end = this.parseEventDate(event.end, timeZone);
        if (!start || !end) {
            return null;
        }

        const status = start.getTime() > now.getTime()
            ? "upcoming"
            : end.getTime() > now.getTime() ? "ongoing" : "past";

        return {
            id: event.id ?? "",
            title: event.summary ?? "Untitled event",
            start: this.formatDateTime(start, timeZone),
            end: this.formatDateTime(end, timeZone),
            startTime: this.formatTime(start, timeZone),
            endTime: this.formatTime(end, timeZone),
            allDay: Boolean(event.start?.date && !event.start.dateTime),
            location: event.location ?? null,
            url: event.htmlLink ?? null,
            status,
        };
    }

    private parseEventDate(value: GoogleEventDate | undefined, timeZone: string): Date | null {
        if (value?.dateTime) {
            const parsed = new Date(value.dateTime);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (value?.date) {
            const [year, month, day] = value.date.split("-").map(Number);
            return year && month && day ? this.toZonedMidnight(year, month, day, timeZone) : null;
        }
        return null;
    }

    private getLocalDay(date: Date, timeZone: string) {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "numeric",
            day: "numeric",
        }).formatToParts(date);
        const value = (type: Intl.DateTimeFormatPartTypes) =>
            Number(parts.find((part) => part.type === type)?.value);

        return { year: value("year"), month: value("month"), day: value("day") };
    }

    private formatDateTime(date: Date, timeZone: string): string {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
            timeZoneName: "longOffset",
        }).formatToParts(date);
        const value = (type: Intl.DateTimeFormatPartTypes) =>
            parts.find((part) => part.type === type)?.value ?? "";
        const offset = value("timeZoneName").replace("GMT", "") || "Z";

        return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}${offset}`;
    }

    private formatTime(date: Date, timeZone: string): string {
        return new Intl.DateTimeFormat("en-US", {
            timeZone,
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        }).format(date);
    }

    private toZonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
        const wallClockUtc = Date.UTC(year, month - 1, day);
        let result = new Date(wallClockUtc);

        // Recalculate once to handle time zones whose offset changes around DST.
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone,
                timeZoneName: "longOffset",
            }).formatToParts(result);
            const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
            const match = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
            const offsetMinutes = match
                ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]))
                : 0;
            result = new Date(wallClockUtc - offsetMinutes * 60_000);
        }

        return result;
    }

    private getMaxResults(value: number | undefined): number {
        if (value === undefined) {
            return 50;
        }
        if (!Number.isInteger(value) || value < 1 || value > 2500) {
            throw new Error("Google Calendar maxResults must be between 1 and 2500");
        }
        return value;
    }
}
