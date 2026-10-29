import { eq } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { systemUsers } from "../db/schema.js";

export interface SystemUser {
    id: string;
    username: string;
    passwordHash: string;
}

export class SystemUserRepository {
    async findByUsername(username: string): Promise<SystemUser | null> {
        const [user] = await getDatabase()
            .select({
                id: systemUsers.id,
                username: systemUsers.username,
                passwordHash: systemUsers.passwordHash,
            })
            .from(systemUsers)
            .where(eq(systemUsers.username, username))
            .limit(1);

        return user ?? null;
    }

    async create(username: string, passwordHash: string): Promise<SystemUser> {
        const [user] = await getDatabase()
            .insert(systemUsers)
            .values({ username, passwordHash })
            .returning({
                id: systemUsers.id,
                username: systemUsers.username,
                passwordHash: systemUsers.passwordHash,
            });

        if (!user) {
            throw new Error("Unable to create the system user");
        }

        return user;
    }
}
