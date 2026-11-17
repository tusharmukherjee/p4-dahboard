import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
import { OAuthTokenRepository } from "../auth/oauthTokenRepository.js";
import { getDatabase } from "../db/client.js";
import { marketIndexSnapshots } from "../db/schema.js";

const BASE_URL = "https://api.upstox.com/v3";
const PROVIDER = "upstox";
const MAX_INSTRUMENTS = 20;
const SNAPSHOT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const tokens = new OAuthTokenRepository();

export const SUPPORTED_MARKET_INDICES = [
    { name: "NIFTY 50", symbol: "NIFTY 50", instrumentKey: "NSE_INDEX|Nifty 50", category: "Broad market" },
    { name: "NIFTY BANK", symbol: "NIFTY BANK", instrumentKey: "NSE_INDEX|Nifty Bank", category: "Sector index" },
    { name: "INDIA VIX", symbol: "INDIA VIX", instrumentKey: "NSE_INDEX|India VIX", category: "Volatility" },
] as const;

interface UpstoxOhlc {
    open?: unknown;
    high?: unknown;
    low?: unknown;
    close?: unknown;
    ts?: unknown;
}

interface UpstoxQuote {
    ohlc?: UpstoxOhlc;
    timestamp?: unknown;
    instrument_token?: unknown;
    last_price?: unknown;
    net_change?: unknown;
    prev_close_price?: unknown;
}

interface UpstoxResponse {
    status?: unknown;
    data?: unknown;
    errors?: Array<{ message?: string }>;
}

export interface MarketQuote {
    instrumentKey: string;
    name: string;
    symbol: string;
    timestamp: string | null;
    last: number;
    open: number;
    high: number;
    low: number;
    previousClose: number;
    netChange: number;
    percentChange: number;
    rangePositionPercent: number | null;
}

export interface MomentumResult {
    minutes: 5 | 15;
    referencePrice: number | null;
    change: number | null;
    percentChange: number | null;
    status: "strengthening" | "weakening" | "steady" | "collecting";
}

export class UpstoxProviderError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}

export async function upstoxTokenConfigured(): Promise<boolean> {
    return (await tokens.get(PROVIDER)) !== null;
}

export async function saveUpstoxToken(token: string): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed || trimmed.length > 4096 || /[\r\n]/.test(trimmed)) {
        throw new UpstoxProviderError("Enter a valid Upstox bearer token", 400);
    }
    await fetchUpstoxQuotes(["NSE_INDEX|Nifty 50"], trimmed);
    await tokens.save(PROVIDER, {
        accessToken: trimmed,
        refreshToken: null,
        expiresAt: null,
        scopes: "market-quote",
    });
}

export async function marketQuotes(instrumentKeys: string[]): Promise<MarketQuote[]> {
    validateInstrumentKeys(instrumentKeys);
    const body = await fetchUpstoxQuotes(instrumentKeys);
    const data = body.data;
    if (!isRecord(data)) {
        throw new UpstoxProviderError("Upstox returned invalid quote data", 502);
    }

    const byInstrument = new Map<string, UpstoxQuote>();
    for (const value of Object.values(data)) {
        if (isRecord(value) && typeof value.instrument_token === "string") {
            byInstrument.set(value.instrument_token, value as UpstoxQuote);
        }
    }

    return instrumentKeys.map((instrumentKey) => {
        const raw = byInstrument.get(instrumentKey);
        if (!raw) throw new UpstoxProviderError(`Upstox did not return ${instrumentKey}`, 502);
        return mapQuote(instrumentKey, raw);
    });
}

export async function momentumForQuotes(
    quotes: MarketQuote[],
    minutes: 5 | 15,
    capturedAt: Date,
): Promise<Map<string, MomentumResult>> {
    const database = getDatabase();
    const target = new Date(capturedAt.getTime() - minutes * 60_000);
    const earliest = new Date(target.getTime() - 5 * 60_000);

    const references = await Promise.all(quotes.map(async (quote) => {
        const [snapshot] = await database
            .select({ price: marketIndexSnapshots.price })
            .from(marketIndexSnapshots)
            .where(and(
                eq(marketIndexSnapshots.instrumentKey, quote.instrumentKey),
                gte(marketIndexSnapshots.capturedAt, earliest),
                lte(marketIndexSnapshots.capturedAt, target),
            ))
            .orderBy(desc(marketIndexSnapshots.capturedAt))
            .limit(1);
        return [quote.instrumentKey, snapshot?.price ?? null] as const;
    }));

    await database.insert(marketIndexSnapshots).values(quotes.map((quote) => ({
        instrumentKey: quote.instrumentKey,
        price: quote.last,
        capturedAt,
    })));
    await database.delete(marketIndexSnapshots)
        .where(lt(marketIndexSnapshots.capturedAt, new Date(capturedAt.getTime() - SNAPSHOT_RETENTION_MS)));

    const results: Array<[string, MomentumResult]> = references.map(([instrumentKey, referencePrice]) => {
        const quote = quotes.find((item) => item.instrumentKey === instrumentKey)!;
        if (referencePrice === null || referencePrice === 0) {
            return [instrumentKey, {
                minutes, referencePrice: null, change: null, percentChange: null, status: "collecting",
            }];
        }
        const change = quote.last - referencePrice;
        const percentChange = change / referencePrice * 100;
        const status = percentChange > 0.02
            ? "strengthening" : percentChange < -0.02 ? "weakening" : "steady";
        return [instrumentKey, {
            minutes,
            referencePrice: round(referencePrice, 2),
            change: round(change, 2),
            percentChange: round(percentChange, 2),
            status,
        }];
    });
    return new Map(results);
}

async function fetchUpstoxQuotes(
    instrumentKeys: string[],
    tokenOverride?: string,
): Promise<UpstoxResponse> {
    validateInstrumentKeys(instrumentKeys);
    const token = tokenOverride ?? (await tokens.get(PROVIDER))?.accessToken;
    if (!token) throw new UpstoxProviderError("Upstox bearer token is not configured", 409);
    const query = new URLSearchParams({ instrument_key: instrumentKeys.join(",") });
    let response: Response;
    try {
        response = await fetch(`${BASE_URL}/market-quote/quotes?${query}`, {
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new UpstoxProviderError("Upstox is unavailable", 502);
    }
    let body: UpstoxResponse;
    try { body = await response.json() as UpstoxResponse; }
    catch { throw new UpstoxProviderError(`Upstox returned HTTP ${response.status} with invalid JSON`, 502); }
    if (!response.ok || body.status !== "success") {
        const providerMessage = body.errors?.[0]?.message;
        const status = response.status === 401 || response.status === 403 ? 401
            : response.status === 429 ? 429 : 502;
        throw new UpstoxProviderError(
            status === 401 ? "Upstox bearer token is invalid or expired"
                : status === 429 ? "Upstox rate limit reached"
                : providerMessage || `Upstox returned HTTP ${response.status}`,
            status,
        );
    }
    return body;
}

function mapQuote(instrumentKey: string, raw: UpstoxQuote): MarketQuote {
    const definition = SUPPORTED_MARKET_INDICES.find((item) => item.instrumentKey === instrumentKey);
    const last = requiredNumber(raw.last_price, `${instrumentKey}.last_price`);
    const netChange = requiredNumber(raw.net_change, `${instrumentKey}.net_change`);
    const previousClose = optionalNumber(raw.prev_close_price) ?? last - netChange;
    const high = requiredNumber(raw.ohlc?.high, `${instrumentKey}.ohlc.high`);
    const low = requiredNumber(raw.ohlc?.low, `${instrumentKey}.ohlc.low`);
    return {
        instrumentKey,
        name: definition?.name ?? instrumentKey.split("|").at(-1) ?? instrumentKey,
        symbol: definition?.symbol ?? instrumentKey.split("|").at(-1) ?? instrumentKey,
        timestamp: typeof raw.timestamp === "string" ? raw.timestamp : null,
        last: round(last, 2),
        open: round(requiredNumber(raw.ohlc?.open, `${instrumentKey}.ohlc.open`), 2),
        high: round(high, 2),
        low: round(low, 2),
        previousClose: round(previousClose, 2),
        netChange: round(netChange, 2),
        percentChange: previousClose === 0 ? 0 : round(netChange / previousClose * 100, 2),
        rangePositionPercent: high === low ? null : round(
            Math.min(100, Math.max(0, (last - low) / (high - low) * 100)),
            1,
        ),
    };
}

function validateInstrumentKeys(value: string[]): void {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_INSTRUMENTS ||
        value.some((key) => typeof key !== "string" || !/^NSE_INDEX\|[^,|]{1,80}$/.test(key)) ||
        new Set(value).size !== value.length) {
        throw new UpstoxProviderError(`Choose 1 to ${MAX_INSTRUMENTS} unique NSE index instruments`, 400);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function requiredNumber(value: unknown, field: string): number {
    const number = optionalNumber(value);
    if (number === null) throw new UpstoxProviderError(`Upstox returned invalid ${field}`, 502);
    return number;
}

function optionalNumber(value: unknown): number | null {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? number : null;
}

function round(value: number, places: number): number {
    const factor = 10 ** places;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}
