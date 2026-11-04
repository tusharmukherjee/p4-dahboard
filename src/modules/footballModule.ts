import type { DashboardModule, ModuleContext, ModuleResult } from "./contracts.js";
import { liveMatch, nextMatch, type FootballMatch } from "../football/footballService.js";

interface FootballConfig { payload?: { teamId?: number; competitionCode?: string } }

function compact(match: FootballMatch | null) {
    if (!match) return null;
    return {
        id: match.id,
        utcDate: match.utcDate,
        status: match.status,
        competition: match.competition.name,
        competitionCode: match.competition.code,
        homeTeam: match.homeTeam.shortName || match.homeTeam.name,
        awayTeam: match.awayTeam.shortName || match.awayTeam.name,
        homeTla: match.homeTeam.tla,
        awayTla: match.awayTeam.tla,
        homeScore: match.score?.fullTime?.home ?? null,
        awayScore: match.score?.fullTime?.away ?? null,
    };
}

export class FootballModule implements DashboardModule<FootballConfig, unknown> {
    readonly id = "football";
    readonly name = "Football";

    async getData(config: FootballConfig, context: ModuleContext): Promise<ModuleResult<unknown>> {
        const teamId = config.payload?.teamId;
        const code = config.payload?.competitionCode;
        if (typeof teamId !== "number" || !Number.isSafeInteger(teamId) || teamId < 1 ||
            typeof code !== "string" || !/^[A-Z0-9]{2,8}$/.test(code)) {
            throw new Error("Football requires a team and competition in its payload");
        }
        const [live, upcoming] = await Promise.all([
            liveMatch(teamId),
            nextMatch(teamId),
        ]);
        return {
            moduleId: this.id,
            generatedAt: context.now.toISOString(),
            data: {
                teamId, competitionCode: code,
                live: compact(live),
                upcoming: compact(upcoming),
            },
        };
    }
}
