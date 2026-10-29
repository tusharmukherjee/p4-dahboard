import { randomBytes } from "node:crypto";
import { OAuthTokenRepository } from "../auth/oauthTokenRepository.js";

interface GoogleTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
}

interface GoogleAuthorizationTokens {
    expiresIn: number;
    scope: string;
}

const STATE_LIFETIME_MS = 10 * 60 * 1000;
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

export class GoogleOAuth {
    private readonly pendingStates = new Map<string, number>();
    private readonly tokens = new OAuthTokenRepository();
    private accessToken: string | null = null;
    private accessTokenExpiresAt = 0;

    createAuthorizationUrl(): string {
        const state = randomBytes(24).toString("hex");
        this.removeExpiredStates();
        this.pendingStates.set(state, Date.now() + STATE_LIFETIME_MS);

        const query = new URLSearchParams({
            client_id: this.requireEnvironmentVariable("GOOGLE_CLIENT_ID"),
            redirect_uri: this.getRedirectUri(),
            response_type: "code",
            scope: GOOGLE_CALENDAR_SCOPE,
            access_type: "offline",
            include_granted_scopes: "true",
            // Google may otherwise omit a refresh token after the first consent.
            prompt: "consent",
            state,
        });

        return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
    }

    async handleCallback(code: string, state: string): Promise<GoogleAuthorizationTokens> {
        if (!this.consumeState(state)) {
            throw new Error("Invalid or expired Google OAuth state");
        }

        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: this.requireEnvironmentVariable("GOOGLE_CLIENT_ID"),
                client_secret: this.requireEnvironmentVariable("GOOGLE_CLIENT_SECRET"),
                redirect_uri: this.getRedirectUri(),
                grant_type: "authorization_code",
            }),
        });
        const body = await response.json() as GoogleTokenResponse;
        const existingTokens = await this.tokens.get("google");
        const refreshToken = body.refresh_token ?? existingTokens?.refreshToken ?? null;

        if (!response.ok || !body.access_token || !refreshToken) {
            const details = body.error_description ?? body.error ?? `status ${response.status}`;
            throw new Error(`Google authorization failed: ${details}`);
        }

        const expiresIn = body.expires_in ?? 3600;
        const expiresAt = new Date(Date.now() + expiresIn * 1000);
        await this.tokens.save("google", {
            accessToken: body.access_token,
            refreshToken,
            expiresAt,
            scopes: body.scope ?? GOOGLE_CALENDAR_SCOPE,
        });

        this.accessToken = body.access_token;
        this.accessTokenExpiresAt = expiresAt.getTime() - 60_000;

        return {
            expiresIn,
            scope: body.scope ?? GOOGLE_CALENDAR_SCOPE,
        };
    }

    async getAccessToken(forceRefresh = false): Promise<string> {
        if (!forceRefresh && this.accessToken && Date.now() < this.accessTokenExpiresAt) {
            return this.accessToken;
        }

        const storedTokens = await this.tokens.get("google");
        if (
            !forceRefresh
            && storedTokens?.expiresAt
            && storedTokens.expiresAt.getTime() > Date.now() + 60_000
        ) {
            this.accessToken = storedTokens.accessToken;
            this.accessTokenExpiresAt = storedTokens.expiresAt.getTime() - 60_000;
            return this.accessToken;
        }

        if (!storedTokens?.refreshToken) {
            throw new Error("Google Calendar is not connected. Visit /google/login first.");
        }

        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: this.requireEnvironmentVariable("GOOGLE_CLIENT_ID"),
                client_secret: this.requireEnvironmentVariable("GOOGLE_CLIENT_SECRET"),
                refresh_token: storedTokens.refreshToken,
                grant_type: "refresh_token",
            }),
        });
        const body = await response.json() as GoogleTokenResponse;

        if (!response.ok || !body.access_token) {
            const details = body.error_description ?? body.error ?? `status ${response.status}`;
            throw new Error(`Unable to refresh Google access token: ${details}`);
        }

        const expiresIn = body.expires_in ?? 3600;
        const expiresAt = new Date(Date.now() + expiresIn * 1000);
        await this.tokens.save("google", {
            accessToken: body.access_token,
            refreshToken: body.refresh_token ?? storedTokens.refreshToken,
            expiresAt,
            scopes: body.scope ?? storedTokens.scopes,
        });

        this.accessToken = body.access_token;
        this.accessTokenExpiresAt = expiresAt.getTime() - 60_000;
        return this.accessToken;
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
        return process.env.GOOGLE_REDIRECT_URI
            ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}/google/callback`;
    }

    private requireEnvironmentVariable(name: string): string {
        const value = process.env[name];
        if (!value) {
            throw new Error(`${name} is not configured`);
        }
        return value;
    }
}
