import type { DashboardModule, ModuleContext, ModuleResult } from "./contracts.js";
import {
    marketQuotes,
    momentumForQuotes,
    type MarketQuote,
    type MomentumResult,
} from "../market/upstoxService.js";

interface MarketInsightsConfig {
    payload?: {
        instrumentKeys?: string[];
        momentumMinutes?: 5 | 15;
    };
}

interface MarketIndexInsight extends MarketQuote {
    momentum: MomentumResult;
}

interface RelativeStrength {
    bankPercentChange: number;
    niftyPercentChange: number;
    spreadPercentagePoints: number;
    leader: "banks" | "nifty" | "balanced";
    summary: string;
}

interface MarketInsightsData {
    provider: "upstox";
    timestamp: string;
    momentumMinutes: 5 | 15;
    indices: MarketIndexInsight[];
    relativeStrength: RelativeStrength | null;
}

export class MarketBreadthModule implements DashboardModule<MarketInsightsConfig, MarketInsightsData> {
    readonly id = "market-breadth";
    readonly name = "Market Insights";

    async getData(
        config: MarketInsightsConfig,
        context: ModuleContext,
    ): Promise<ModuleResult<MarketInsightsData>> {
        const instrumentKeys = config.payload?.instrumentKeys;
        if (!Array.isArray(instrumentKeys)) {
            throw new Error("Market insights requires selected instrument keys");
        }
        const momentumMinutes = config.payload?.momentumMinutes ?? 5;
        if (momentumMinutes !== 5 && momentumMinutes !== 15) {
            throw new Error("Market momentum window must be 5 or 15 minutes");
        }

        const quotes = await marketQuotes(instrumentKeys);
        const momentum = await momentumForQuotes(quotes, momentumMinutes, context.now);
        const indices = quotes.map((quote) => ({
            ...quote,
            momentum: momentum.get(quote.instrumentKey)!,
        }));

        return {
            moduleId: this.id,
            generatedAt: context.now.toISOString(),
            data: {
                provider: "upstox",
                timestamp: latestTimestamp(quotes) ?? context.now.toISOString(),
                momentumMinutes,
                indices,
                relativeStrength: relativeStrength(indices),
            },
        };
    }
}

function relativeStrength(indices: MarketIndexInsight[]): RelativeStrength | null {
    const bank = indices.find((item) => item.instrumentKey === "NSE_INDEX|Nifty Bank");
    const nifty = indices.find((item) => item.instrumentKey === "NSE_INDEX|Nifty 50");
    if (!bank || !nifty) return null;
    const spread = round(bank.percentChange - nifty.percentChange, 2);
    const leader = Math.abs(spread) < 0.05 ? "balanced" : spread > 0 ? "banks" : "nifty";
    const summary = leader === "balanced"
        ? "Banks and NIFTY 50 are broadly balanced"
        : `${leader === "banks" ? "Banks" : "NIFTY 50"} lead by ${Math.abs(spread).toFixed(2)} percentage points`;
    return {
        bankPercentChange: bank.percentChange,
        niftyPercentChange: nifty.percentChange,
        spreadPercentagePoints: spread,
        leader,
        summary,
    };
}

function latestTimestamp(quotes: MarketQuote[]): string | null {
    return quotes.map((quote) => quote.timestamp).filter((value): value is string => Boolean(value))
        .sort().at(-1) ?? null;
}

function round(value: number, places: number): number {
    const factor = 10 ** places;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}
