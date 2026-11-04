import { eq } from "drizzle-orm";
import { OAuthTokenRepository } from "../auth/oauthTokenRepository.js";
import { getDatabase } from "../db/client.js";
import { footballCache } from "../db/schema.js";

const BASE_URL = "https://api.football-data.org/v4";
const PROVIDER = "football-data";
const HOUR = 60 * 60 * 1000;
const inFlight = new Map<string, Promise<unknown>>();
const tokens = new OAuthTokenRepository();

export interface Competition {
    id: number;
    name: string;
    code: string;
    type: string;
    area: { name: string; code: string | null };
}

export interface Team {
    id: number;
    name: string;
    shortName: string;
    tla: string;
    crest: string | null;
}

export interface FootballMatch {
    id: number;
    utcDate: string;
    status: string;
    competition: { code: string; name: string };
    homeTeam: Team;
    awayTeam: Team;
    score: { fullTime: { home: number | null; away: number | null } };
}

export class FootballProviderError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function list(value: unknown, key: string): unknown[] {
    if (!record(value) || !Array.isArray(value[key])) {
        throw new FootballProviderError(`Football provider returned invalid ${key} data`, 502);
    }
    return value[key];
}

async function providerGet(path: string, tokenOverride?: string): Promise<unknown> {
    const token = tokenOverride ?? (await tokens.get(PROVIDER))?.accessToken;
    if (!token) throw new FootballProviderError("Football API token is not configured", 409);
    let response: Response;
    try {
        response = await fetch(`${BASE_URL}${path}`, {
            headers: { "X-Auth-Token": token },
            signal: AbortSignal.timeout(10000),
        });
    } catch {
        throw new FootballProviderError("Football provider is unavailable", 502);
    }
    if (!response.ok) {
        const status = response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 401 : 502;
        throw new FootballProviderError(
            response.status === 429 ? "Football API rate limit reached" :
            status === 401 ? "Football API token is invalid or lacks access" :
            `Football provider returned HTTP ${response.status}`,
            status,
        );
    }
    try { return await response.json() as unknown; }
    catch { throw new FootballProviderError("Football provider returned invalid JSON", 502); }
}

async function cached<T>(key: string, path: string, ttl: (body: T, now: number) => number,
                         validate: (body: unknown) => T): Promise<T> {
    const [row] = await getDatabase().select().from(footballCache)
        .where(eq(footballCache.key, key)).limit(1);
    const now = Date.now();
    if (row && row.expiresAt.getTime() > now) return row.response as T;
    let request = inFlight.get(key) as Promise<T> | undefined;
    if (!request) {
        request = (async () => {
            const body = validate(await providerGet(path));
            const fetchedAt = new Date();
            const expiresAt = new Date(fetchedAt.getTime() + Math.max(1000, ttl(body, fetchedAt.getTime())));
            await getDatabase().insert(footballCache)
                .values({ key, response: body, fetchedAt, expiresAt })
                .onConflictDoUpdate({ target: footballCache.key, set: { response: body, fetchedAt, expiresAt } });
            return body;
        })();
        inFlight.set(key, request);
    }
    try { return await request; }
    catch (error) {
        // A stale saved result is preferable to a blank panel during provider outages.
        if (row && (!key.startsWith("live:") || now - row.fetchedAt.getTime() <= 5 * 60_000)) {
            return row.response as T;
        }
        throw error;
    } finally {
        if (inFlight.get(key) === request) inFlight.delete(key);
    }
}

export async function tokenConfigured(): Promise<boolean> {
    return (await tokens.get(PROVIDER)) !== null;
}

export async function saveToken(token: string): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed || trimmed.length > 512 || /[\r\n]/.test(trimmed)) {
        throw new FootballProviderError("Enter a valid football API token", 400);
    }
    list(await providerGet("/competitions", trimmed), "competitions");
    await tokens.save(PROVIDER, { accessToken: trimmed, refreshToken: null, expiresAt: null, scopes: null });
    await getDatabase().delete(footballCache);
}

export async function competitions(): Promise<Competition[]> {
    const body = await cached("competitions", "/competitions", () => 12 * HOUR,
        (value) => list(value, "competitions") as Competition[]);
    return body.filter((item) => Number.isInteger(item.id) && typeof item.code === "string"
        && typeof item.name === "string" && typeof item.area?.name === "string");
}

export async function teams(code: string): Promise<Team[]> {
    const body = await cached(`teams:${code}`, `/competitions/${code}/teams`, () => 12 * HOUR,
        (value) => list(value, "teams") as Team[]);
    return body.filter((item) => Number.isInteger(item.id) && typeof item.name === "string");
}

function matches(value: unknown): FootballMatch[] {
    return list(value, "matches").filter((item): item is FootballMatch =>
        record(item) && Number.isInteger(item.id) && typeof item.utcDate === "string"
        && typeof item.status === "string" && record(item.homeTeam) && record(item.awayTeam)
        && record(item.competition)) as FootballMatch[];
}

export async function nextMatch(teamId: number): Promise<FootballMatch | null> {
    const body = await cached(`next:any:${teamId}`,
        `/teams/${teamId}/matches?status=SCHEDULED&limit=1`,
        (items, now) => {
            const kickoff = items[0] ? Date.parse(items[0].utcDate) : Number.NaN;
            return Number.isFinite(kickoff) ? Math.min(6 * HOUR, Math.max(60_000, kickoff - now)) : HOUR;
        }, matches);
    return body[0] ?? null;
}

export async function liveMatch(teamId: number): Promise<FootballMatch | null> {
    const body = await cached(`live:any:${teamId}`,
        `/teams/${teamId}/matches?status=LIVE`, () => 60_000, matches);
    return body[0] ?? null;
}
