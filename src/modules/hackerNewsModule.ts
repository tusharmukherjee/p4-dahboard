import type { DashboardModule, ModuleContext, ModuleResult } from "./contracts.js";

interface HackerNewsConfig {
    payload?: {
        batchSize?: number;
        nextIndex?: number;
        version?: number | null;
    };
}

interface HackerNewsItem {
    type?: string;
    title?: string;
    time?: number;
    deleted?: boolean;
    dead?: boolean;
}

interface HackerNewsData {
    headings: string[];
}

const API_BASE_URL = "https://hacker-news.firebaseio.com/v0";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_CHUNK_SIZE = 10;

export class HackerNewsModule implements DashboardModule<HackerNewsConfig, HackerNewsData> {
    readonly id = "hacker-news";
    readonly name = "Hacker News";

    async getData(
        config: HackerNewsConfig,
        context: ModuleContext,
    ): Promise<ModuleResult<HackerNewsData>> {
        const batchSize = this.getBatchSize(config.payload?.batchSize);
        const version = this.getVersion(config.payload?.version, context.now);
        const cutoffTime = version - ONE_DAY_MS;
        const storyIds = await this.fetchTopStoryIds();
        let nextIndex = this.getNextIndex(config.payload?.nextIndex, storyIds.length);
        const headings: string[] = [];

        while (nextIndex < storyIds.length && headings.length < batchSize) {
            const ids = storyIds.slice(nextIndex, nextIndex + FETCH_CHUNK_SIZE);
            const stories = await Promise.all(ids.map((id) => this.fetchStory(id)));

            for (const story of stories) {
                nextIndex += 1;
                if (
                    story?.type === "story"
                    && !story.deleted
                    && !story.dead
                    && typeof story.title === "string"
                    && typeof story.time === "number"
                    && story.time * 1000 >= cutoffTime
                ) {
                    headings.push(story.title);
                    if (headings.length === batchSize) {
                        break;
                    }
                }
            }
        }

        const reachedEnd = nextIndex >= storyIds.length;

        return {
            moduleId: this.id,
            generatedAt: context.now.toISOString(),
            data: { headings },
            nextState: {
                nextIndex: reachedEnd ? 0 : nextIndex,
                version: reachedEnd ? null : version,
            },
        };
    }

    private async fetchTopStoryIds(): Promise<number[]> {
        const response = await fetch(`${API_BASE_URL}/beststories.json?h=24`);
        if (!response.ok) {
            throw new Error(`Hacker News top stories API returned ${response.status}`);
        }

        const body: unknown = await response.json();
        if (!Array.isArray(body)) {
            throw new Error("Hacker News top stories API returned an invalid response");
        }

        return body.filter((id): id is number => Number.isInteger(id));
    }

    private async fetchStory(id: number): Promise<HackerNewsItem | null> {
        const response = await fetch(`${API_BASE_URL}/item/${id}.json`);
        if (!response.ok) {
            throw new Error(`Hacker News item API returned ${response.status}`);
        }

        return await response.json() as HackerNewsItem | null;
    }

    private getBatchSize(batchSize: number | undefined): number {
        if (batchSize === undefined) {
            return 5;
        }
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
            throw new Error("Hacker News batchSize must be an integer between 1 and 50");
        }

        return batchSize;
    }

    private getNextIndex(nextIndex: number | undefined, storyCount: number): number {
        return Number.isInteger(nextIndex) && nextIndex! >= 0 && nextIndex! < storyCount
            ? nextIndex!
            : 0;
    }

    private getVersion(version: number | null | undefined, now: Date): number {
        return typeof version === "number" && Number.isFinite(version) && version > 0
            ? version
            : now.getTime();
    }
}
