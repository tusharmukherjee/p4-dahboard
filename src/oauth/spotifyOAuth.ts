import { randomBytes } from "node:crypto";
import { OAuthTokenRepository } from "../auth/oauthTokenRepository.js";

interface SpotifyAuthorizationTokens {
    accessToken: string;
    expiresIn: number;
    scope: string;
}

interface SpotifyTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
}

const STATE_LIFETIME_MS = 10 * 60 * 1000;
const SPOTIFY_SCOPE = "user-read-currently-playing";

export class SpotifyOAuth {
    private readonly pendingStates = new Map<string, number>();
    private readonly tokens = new OAuthTokenRepository();

    createAuthorizationUrl(): string {
        const clientId = this.requireEnvironmentVariable("SPOTIFY_CLIENT_ID");
        const state = randomBytes(24).toString("hex");

        this.removeExpiredStates();
        this.pendingStates.set(state, Date.now() + STATE_LIFETIME_MS);

        const query = new URLSearchParams({
            response_type: "code",
            client_id: clientId,
            scope: SPOTIFY_SCOPE,
            redirect_uri: this.getRedirectUri(),
            state,
        });

        return `https://accounts.spotify.com/authorize?${query.toString()}`;
    }

    async handleCallback(code: string, state: string): Promise<SpotifyAuthorizationTokens> {
        if (!this.consumeState(state)) {
            throw new Error("Invalid or expired Spotify OAuth state");
        }

        const clientId = this.requireEnvironmentVariable("SPOTIFY_CLIENT_ID");
        const clientSecret = this.requireEnvironmentVariable("SPOTIFY_CLIENT_SECRET");
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: this.getRedirectUri(),
            }),
        });
        const body = await response.json() as SpotifyTokenResponse;

        if (!response.ok || !body.access_token || !body.refresh_token) {
            const details = body.error_description ?? body.error ?? `status ${response.status}`;
            throw new Error(`Spotify authorization failed: ${details}`);
        }

        const expiresIn = body.expires_in ?? 3600;
        await this.tokens.save("spotify", {
            accessToken: body.access_token,
            refreshToken: body.refresh_token,
            expiresAt: new Date(Date.now() + expiresIn * 1000),
            scopes: body.scope ?? SPOTIFY_SCOPE,
        });

        return {
            accessToken: body.access_token,
            expiresIn,
            scope: body.scope ?? SPOTIFY_SCOPE,
        };
    }

    private consumeState(state: string): boolean {
        const expiresAt = this.pendingStates.get(state);
        this.pendingStates.delete(state);

        return expiresAt !== undefined && expiresAt >= Date.now();
    }

    private removeExpiredStates(): void {
        const now = Date.now();
        for (const [state, expiresAt] of this.pendingStates) {
            if (expiresAt < now) {
                this.pendingStates.delete(state);
            }
        }
    }

    private getRedirectUri(): string {
        return process.env.SPOTIFY_REDIRECT_URI
            ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}/callback`;
    }

    private requireEnvironmentVariable(name: string): string {
        const value = process.env[name];
        if (!value) {
            throw new Error(`${name} is not configured`);
        }

        return value;
    }
}
