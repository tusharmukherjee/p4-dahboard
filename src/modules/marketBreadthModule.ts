import { BaseModule } from "./baseModule.js";
import type { ModuleContext } from "./contracts.js";

const DEFAULT_API_URL = "https://www.nseindia.in/api/allIndices";
const MAX_SELECTED_INDICES = 20;
const REQUEST_TIMEOUT_MS = 15_000;
const BROWSER_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface MarketBreadthConfig {
    payload?: {
        indices?: string[];
    };
}

interface ProviderIndex {
    key?: unknown;
    index?: unknown;
    indexSymbol?: unknown;
    last?: unknown;
    variation?: unknown;
    percentChange?: unknown;
    advances?: unknown;
    declines?: unknown;
    unchanged?: unknown;
}

interface ProviderResponse {
    data?: unknown;
    timestamp?: unknown;
    advances?: unknown;
    declines?: unknown;
    unchanged?: unknown;
}

export interface MarketBreadthData {
    timestamp: string | null;
    breadth: {
        advancing: number;
        declining: number;
        unchanged: number;
        total: number;
        advancingPercent: number;
        decliningPercent: number;
        unchangedPercent: number;
        advanceDeclineRatio: number | null;
        netAdvances: number;
        status: "very-strong" | "positive" | "mixed" | "negative" | "very-weak";
        statusLabel: string;
        interpretation: string;
    };
    indices: Array<{
        name: string;
        symbol: string;
        last: number;
        variation: number;
        percentChange: number;
        advancing: number;
        declining: number;
        unchanged: number;
    }>;
}

export class MarketBreadthModule extends BaseModule<MarketBreadthConfig, MarketBreadthData> {
    readonly id = "market-breadth";
    readonly name = "Market Breadth";

    protected async fetch(
        config: MarketBreadthConfig,
        _context: ModuleContext,
    ): Promise<MarketBreadthData> {
        const selectedIndices = validateSelectedIndices(config.payload?.indices);
        return mapMarketResponse(await fetchProviderResponse(), selectedIndices);
    }
}

export async function listAvailableMarketIndices(): Promise<Array<{
    name: string;
    symbol: string;
    category: string | null;
}>> {
    const body = await fetchProviderResponse();
    if (!Array.isArray(body.data)) {
        throw new Error("Market indices API returned an invalid data array");
    }

    const seen = new Set<string>();
    return (body.data as ProviderIndex[]).flatMap((item) => {
        if (!item || typeof item !== "object" || typeof item.index !== "string" ||
            typeof item.indexSymbol !== "string") return [];
        const normalized = normalizeName(item.indexSymbol);
        if (seen.has(normalized)) return [];
        seen.add(normalized);
        return [{
            name: item.index,
            symbol: item.indexSymbol,
            category: typeof item.key === "string" ? item.key : null,
        }];
    });
}

async function fetchProviderResponse(): Promise<ProviderResponse> {
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const apiUrl = new URL(process.env.MARKET_INDICES_API_URL ?? DEFAULT_API_URL);
    const directStartedAt = Date.now();
    console.info(`[market:${requestId}] provider request started url=${safeUrl(apiUrl)}`);
    let response: Response;
    try {
        response = await fetch(apiUrl, {
            headers: providerApiHeaders(`${apiUrl.origin}/market-data/live-equity-market`),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        console.error(
            `[market:${requestId}] direct request failed after=${Date.now() - directStartedAt}ms`,
            error,
        );
        throw error;
    }
    console.info(
        `[market:${requestId}] direct response status=${response.status} ` +
        `after=${Date.now() - directStartedAt}ms url=${safeUrl(response.url)} ${edgeDetails(response)}`,
    );

    // NSE's public website API does not use API credentials, but its edge
    // requires the browser-session cookies issued by the website. Cloud hosts
    // commonly receive 401/403 until that session has been established.
    if ((response.status === 401 || response.status === 403) && isNseHost(apiUrl.hostname)) {
        console.warn(`[market:${requestId}] direct request rejected; initializing NSE session`);
        const session = await createNseSession(apiUrl, requestId);
        const retryUrl = new URL(`${apiUrl.pathname}${apiUrl.search}`, session.origin);
        const retryStartedAt = Date.now();
        console.info(
            `[market:${requestId}] retrying provider url=${safeUrl(retryUrl)} ` +
            `cookieCount=${session.cookieCount}`,
        );
        try {
            response = await fetch(retryUrl, {
                headers: providerApiHeaders(
                    `${session.origin}/market-data/live-equity-market`,
                    session.cookie,
                ),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            console.error(
                `[market:${requestId}] retry failed after=${Date.now() - retryStartedAt}ms`,
                error,
            );
            throw error;
        }
        console.info(
            `[market:${requestId}] retry response status=${response.status} ` +
            `after=${Date.now() - retryStartedAt}ms url=${safeUrl(response.url)} ${edgeDetails(response)}`,
        );
    }

    if (!response.ok) {
        const hint = response.status === 403 && isNseHost(apiUrl.hostname)
            ? "; NSE may be blocking the hosting provider's IP address"
            : "";
        console.error(
            `[market:${requestId}] provider request failed status=${response.status} ${edgeDetails(response)}`,
        );
        throw new Error(`Market indices API returned ${response.status}${hint} (request ${requestId})`);
    }

    console.info(`[market:${requestId}] provider request completed successfully`);
    return await response.json() as ProviderResponse;
}

function providerApiHeaders(referer: string, cookie?: string): HeadersInit {
    return {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: referer,
        "User-Agent": BROWSER_USER_AGENT,
        ...(cookie ? { Cookie: cookie } : {}),
    };
}

interface ProviderSession {
    origin: string;
    cookie: string;
    cookieCount: number;
}

async function createNseSession(apiUrl: URL, requestId: string): Promise<ProviderSession> {
    let current = new URL("/", apiUrl.origin);
    const cookies = new Map<string, string>();
    let challengeRetryUsed = false;

    // Follow redirects manually so Set-Cookie headers from intermediate NSE
    // responses are retained (native fetch only exposes the final response).
    for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
        const cookie = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
        const stepStartedAt = Date.now();
        console.info(
            `[market:${requestId}] session step=${redirectCount + 1} url=${safeUrl(current)} ` +
            `cookieCount=${cookies.size}`,
        );
        let response: Response;
        try {
            response = await fetch(current, {
                redirect: "manual",
                headers: {
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
                    "Cache-Control": "no-cache",
                    "User-Agent": BROWSER_USER_AGENT,
                    ...(cookie ? { Cookie: cookie } : {}),
                },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            console.error(
                `[market:${requestId}] session step=${redirectCount + 1} failed ` +
                `after=${Date.now() - stepStartedAt}ms`,
                error,
            );
            throw error;
        }

        const receivedCookieNames: string[] = [];
        let receivedNewCookie = false;
        for (const setCookie of response.headers.getSetCookie()) {
            const pair = setCookie.split(";", 1)[0];
            const separator = pair.indexOf("=");
            if (separator > 0) {
                const name = pair.slice(0, separator);
                const value = pair.slice(separator + 1);
                if (cookies.get(name) !== value) receivedNewCookie = true;
                cookies.set(name, value);
                receivedCookieNames.push(name);
            }
        }
        console.info(
            `[market:${requestId}] session response step=${redirectCount + 1} ` +
            `status=${response.status} after=${Date.now() - stepStartedAt}ms ` +
            `cookies=${receivedCookieNames.length ? receivedCookieNames.join(",") : "none"} ` +
            edgeDetails(response),
        );

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) throw new Error("NSE session redirect did not include a location");
            const next = new URL(location, current);
            if (!isNseHost(next.hostname)) throw new Error("NSE session redirected to an unexpected host");
            console.info(
                `[market:${requestId}] session redirect ${safeUrl(current)} -> ${safeUrl(next)}`,
            );
            current = next;
            continue;
        }

        if (!response.ok) {
            // Akamai may answer the first page request with 403 while issuing
            // AKA_A2. Replay the page once with that cookie, then let the API
            // retry use the best session we obtained even if the HTML page is
            // still blocked. This distinguishes a cookie challenge from a
            // hard hosting-IP block without looping indefinitely.
            if ((response.status === 401 || response.status === 403) && cookies.size > 0) {
                if (receivedNewCookie && !challengeRetryUsed) {
                    challengeRetryUsed = true;
                    console.warn(
                        `[market:${requestId}] session challenge returned ${response.status}; ` +
                        `replaying once with cookieCount=${cookies.size}`,
                    );
                    continue;
                }

                console.warn(
                    `[market:${requestId}] session page remains status=${response.status}; ` +
                    `proceeding to API retry with cookieCount=${cookies.size}`,
                );
                return sessionFromCookies(current, cookies);
            }

            console.error(
                `[market:${requestId}] session initialization rejected status=${response.status} ` +
                `url=${safeUrl(current)} ${edgeDetails(response)}`,
            );
            throw new Error(
                `NSE session initialization returned ${response.status} (request ${requestId})`,
            );
        }

        console.info(
            `[market:${requestId}] session initialized origin=${current.origin} ` +
            `cookieCount=${cookies.size}`,
        );
        return sessionFromCookies(current, cookies);
    }

    throw new Error("NSE session initialization exceeded the redirect limit");
}

function sessionFromCookies(current: URL, cookies: Map<string, string>): ProviderSession {
    return {
        origin: current.origin,
        cookie: [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
        cookieCount: cookies.size,
    };
}

function isNseHost(hostname: string): boolean {
    return hostname === "nseindia.com" || hostname.endsWith(".nseindia.com") ||
        hostname === "nseindia.in" || hostname.endsWith(".nseindia.in");
}

function safeUrl(value: string | URL): string {
    if (!value) return "unknown";
    try {
        const url = typeof value === "string" ? new URL(value) : value;
        return `${url.origin}${url.pathname}`;
    } catch {
        return "invalid-url";
    }
}

function edgeDetails(response: Response): string {
    const details = [
        ["server", response.headers.get("server")],
        ["via", response.headers.get("via")],
        ["x-cache", response.headers.get("x-cache")],
        ["cf-ray", response.headers.get("cf-ray")],
        ["content-type", response.headers.get("content-type")],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]));
    return details.length
        ? `edge=${details.map(([name, value]) => `${name}:${value}`).join("|")}`
        : "edge=unavailable";
}

export function mapMarketResponse(
    body: ProviderResponse,
    selectedIndices: string[],
): MarketBreadthData {
    if (!Array.isArray(body.data)) {
        throw new Error("Market indices API returned an invalid data array");
    }

    const advancing = requiredNonNegativeNumber(body.advances, "advances");
    const declining = requiredNonNegativeNumber(body.declines, "declines");
    const unchanged = requiredNonNegativeNumber(body.unchanged, "unchanged");
    const total = advancing + declining + unchanged;
    if (total === 0) {
        throw new Error("Market indices API returned empty breadth totals");
    }

    const providerIndices = body.data as ProviderIndex[];
    const normalized = new Map<string, ProviderIndex>();
    for (const item of providerIndices) {
        if (!item || typeof item !== "object") continue;
        if (typeof item.index === "string") normalized.set(normalizeName(item.index), item);
        if (typeof item.indexSymbol === "string") normalized.set(normalizeName(item.indexSymbol), item);
    }

    const missing: string[] = [];
    const indices = selectedIndices.flatMap((selected) => {
        const item = normalized.get(normalizeName(selected));
        if (!item) {
            missing.push(selected);
            return [];
        }
        return [{
            name: requiredString(item.index, `${selected}.index`),
            symbol: requiredString(item.indexSymbol, `${selected}.indexSymbol`),
            last: requiredNumber(item.last, `${selected}.last`),
            variation: requiredNumber(item.variation, `${selected}.variation`),
            percentChange: requiredNumber(item.percentChange, `${selected}.percentChange`),
            advancing: requiredNonNegativeNumber(item.advances, `${selected}.advances`),
            declining: requiredNonNegativeNumber(item.declines, `${selected}.declines`),
            unchanged: requiredNonNegativeNumber(item.unchanged, `${selected}.unchanged`),
        }];
    });

    if (missing.length > 0) {
        throw new Error(`Market indices API did not return: ${missing.join(", ")}`);
    }

    const ratio = declining === 0 ? null : round(advancing / declining, 2);
    const classification = classifyBreadth(ratio, advancing, declining);

    return {
        timestamp: typeof body.timestamp === "string" ? body.timestamp : null,
        breadth: {
            advancing,
            declining,
            unchanged,
            total,
            advancingPercent: round(advancing / total * 100, 2),
            decliningPercent: round(declining / total * 100, 2),
            unchangedPercent: round(unchanged / total * 100, 2),
            advanceDeclineRatio: ratio,
            netAdvances: advancing - declining,
            ...classification,
        },
        indices,
    };
}

function validateSelectedIndices(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SELECTED_INDICES) {
        throw new Error(`Market breadth indices must contain between 1 and ${MAX_SELECTED_INDICES} names`);
    }
    if (value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
        throw new Error("Market breadth indices must contain non-empty strings");
    }
    const indices = value.map((item) => (item as string).trim());
    if (new Set(indices.map(normalizeName)).size !== indices.length) {
        throw new Error("Market breadth indices must not contain duplicates");
    }
    return indices;
}

function classifyBreadth(
    ratio: number | null,
    advancing: number,
    declining: number,
): Pick<MarketBreadthData["breadth"], "status" | "statusLabel" | "interpretation"> {
    if (declining === 0 && advancing > 0) {
        return { status: "very-strong", statusLabel: "Very strong buying breadth", interpretation: "Advances with no declines" };
    }
    if (ratio !== null && ratio > 2) {
        return { status: "very-strong", statusLabel: "Very strong buying breadth", interpretation: "Advances strongly outnumber declines" };
    }
    if (ratio !== null && ratio >= 1.2) {
        return { status: "positive", statusLabel: "Positive breadth", interpretation: "More advances than declines" };
    }
    if (ratio !== null && ratio >= 0.8) {
        return { status: "mixed", statusLabel: "Mixed / balanced", interpretation: "Advances and declines are broadly balanced" };
    }
    if (ratio !== null && ratio >= 0.5) {
        return { status: "negative", statusLabel: "Negative breadth", interpretation: "Fewer advances than declines" };
    }
    return { status: "very-weak", statusLabel: "Very weak breadth", interpretation: "Declines strongly outnumber advances" };
}

function normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Market indices API returned an invalid ${field}`);
    }
    return value;
}

function requiredNumber(value: unknown, field: string): number {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed)) {
        throw new Error(`Market indices API returned an invalid ${field}`);
    }
    return parsed;
}

function requiredNonNegativeNumber(value: unknown, field: string): number {
    const parsed = requiredNumber(value, field);
    if (parsed < 0) {
        throw new Error(`Market indices API returned a negative ${field}`);
    }
    return parsed;
}

function round(value: number, decimalPlaces: number): number {
    const factor = 10 ** decimalPlaces;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}
