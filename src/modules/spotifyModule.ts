import { BaseModule } from "./baseModule.js";
import type { ModuleContext } from "./contracts.js";
import { OAuthTokenRepository } from "../auth/oauthTokenRepository.js";

interface SpotifyConfig {
    version?: number;
}

interface SpotifyData {
    isPlaying: boolean;
    song: string | null;
    artists: string[];
    album: string | null;
    progressMs: number | null;
    durationMs: number | null;
}

interface SpotifyTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
}

interface SpotifyItem {
    type?: string;
    name?: string;
    duration_ms?: number;
    artists?: Array<{ name?: string }>;
    album?: {
        name?: string;
        images?: Array<{ url?: string }>;
    };
    show?: {
        name?: string;
        images?: Array<{ url?: string }>;
    };
    external_urls?: { spotify?: string };
}

interface SpotifyCurrentlyPlayingResponse {
    is_playing?: boolean;
    currently_playing_type?: string;
    progress_ms?: number | null;
    item?: SpotifyItem | null;
}

const NOTHING_PLAYING: SpotifyData = {
    isPlaying: false,
    song: null,
    artists: [],
    album: null,
    progressMs: null,
    durationMs: null
};

export class SpotifyModule extends BaseModule<SpotifyConfig, SpotifyData> {
    readonly id = "spotify";
    readonly name = "Spotify";

    private accessToken: string | null = null;
    private accessTokenExpiresAt = 0;
    private readonly tokens = new OAuthTokenRepository();

    protected async fetch(
        _config: SpotifyConfig,
        _context: ModuleContext,
    ): Promise<SpotifyData> {
        let accessToken = await this.getAccessToken();
        let response = await this.fetchCurrentlyPlaying(accessToken);

        // The cached access token may have been revoked before its advertised expiry.
        if (response.status === 401) {
            this.accessToken = null;
            accessToken = await this.getAccessToken();
            response = await this.fetchCurrentlyPlaying(accessToken);
        }

        if (response.status === 204) {
            return { ...NOTHING_PLAYING };
        }

        if (!response.ok) {
            const details = await response.text();
            throw new Error(
                `Spotify currently-playing API returned ${response.status}${details ? `: ${details}` : ""}`,
            );
        }

        const body = await response.json() as SpotifyCurrentlyPlayingResponse;
        const item = body.item;

        if (!item) {
            return { ...NOTHING_PLAYING, isPlaying: Boolean(body.is_playing) };
        }

        const isEpisode = item.type === "episode";

        return {
            isPlaying: Boolean(body.is_playing),
            song: item.name ?? null,
            artists: isEpisode
                ? (item.show?.name ? [item.show.name] : [])
                : (item.artists ?? []).flatMap((artist) => artist.name ? [artist.name] : []),
            album: isEpisode ? item.show?.name ?? null : item.album?.name ?? null,
            progressMs: body.progress_ms ?? null,
            durationMs: item.duration_ms ?? null
        };
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
            return this.accessToken;
        }

        const storedTokens = await this.tokens.get("spotify");
        if (
            storedTokens?.expiresAt
            && storedTokens.expiresAt.getTime() > Date.now() + 60_000
        ) {
            this.accessToken = storedTokens.accessToken;
            this.accessTokenExpiresAt = storedTokens.expiresAt.getTime() - 60_000;
            return this.accessToken;
        }

        const clientId = process.env.SPOTIFY_CLIENT_ID;
        const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        const refreshToken = storedTokens?.refreshToken;

        if (!clientId || !clientSecret || !refreshToken) {
            throw new Error(
                "Spotify is not connected. Configure its client credentials, then visit /spotify/login.",
            );
        }

        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
            }),
        });
        const body = await response.json() as SpotifyTokenResponse;

        if (!response.ok || !body.access_token) {
            const details = body.error_description ?? body.error ?? `status ${response.status}`;
            throw new Error(`Unable to refresh Spotify access token: ${details}`);
        }

        this.accessToken = body.access_token;
        // Refresh one minute early so a token cannot expire during an API request.
        const expiresIn = body.expires_in ?? 3600;
        const expiresAt = new Date(Date.now() + expiresIn * 1000);
        this.accessTokenExpiresAt = expiresAt.getTime() - 60_000;

        await this.tokens.save("spotify", {
            accessToken: body.access_token,
            refreshToken: body.refresh_token ?? refreshToken,
            expiresAt,
            scopes: body.scope ?? storedTokens?.scopes ?? null,
        });

        return this.accessToken;
    }

    private fetchCurrentlyPlaying(accessToken: string): Promise<Response> {
        return fetch(
            "https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode",
            { headers: { Authorization: `Bearer ${accessToken}` } },
        );
    }
}
