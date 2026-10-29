import { and, eq } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { oauthTokens } from "../db/schema.js";
import { decryptSecret, encryptSecret } from "./secretEncryption.js";
import { SystemUserRepository } from "./systemUserRepository.js";

export interface OAuthTokenSet {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    scopes: string | null;
}

export class OAuthTokenRepository {
    private readonly users = new SystemUserRepository();

    async get(provider: string): Promise<OAuthTokenSet | null> {
        const user = await this.getSystemUser();
        const [token] = await getDatabase()
            .select()
            .from(oauthTokens)
            .where(and(
                eq(oauthTokens.userId, user.id),
                eq(oauthTokens.provider, provider),
            ))
            .limit(1);

        if (!token) {
            return null;
        }

        return {
            accessToken: decryptSecret(token.accessTokenEncrypted),
            refreshToken: token.refreshTokenEncrypted
                ? decryptSecret(token.refreshTokenEncrypted)
                : null,
            expiresAt: token.expiresAt,
            scopes: token.scopes,
        };
    }

    async save(provider: string, tokens: OAuthTokenSet): Promise<void> {
        const user = await this.getSystemUser();
        const values = {
            userId: user.id,
            provider,
            accessTokenEncrypted: encryptSecret(tokens.accessToken),
            refreshTokenEncrypted: tokens.refreshToken
                ? encryptSecret(tokens.refreshToken)
                : null,
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes,
            updatedAt: new Date(),
        };

        await getDatabase()
            .insert(oauthTokens)
            .values(values)
            .onConflictDoUpdate({
                target: [oauthTokens.userId, oauthTokens.provider],
                set: values,
            });
    }

    private async getSystemUser() {
        const username = process.env.SYSTEM_USERNAME ?? "admin";
        const user = await this.users.findByUsername(username);
        if (!user) {
            throw new Error(`System user '${username}' does not exist`);
        }

        return user;
    }
}
