import { BaseModule } from "./baseModule.js";
import type { ModuleContext } from "./contracts.js";

const DEFAULT_API_URL = "https://www.nseindia.com/api/allIndices";
const MAX_SELECTED_INDICES = 20;

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
    const response = await fetch(process.env.MARKET_INDICES_API_URL ?? DEFAULT_API_URL, {
        headers: {
            Accept: "application/json",
            "Accept-Language": "en-IN,en;q=0.9",
            Referer: "https://www.nseindia.com/market-data/live-equity-market",
            "User-Agent": "Mozilla/5.0 (compatible; P4Dashboard/1.0)",
        },
        signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
        throw new Error(`Market indices API returned ${response.status}`);
    }

    return await response.json() as ProviderResponse;
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
