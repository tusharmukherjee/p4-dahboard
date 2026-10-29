import { randomBytes } from "node:crypto";
import { hashPassword } from "./password.js";
import { SystemUserRepository } from "./systemUserRepository.js";

export async function initializeSystemUser(): Promise<void> {
    const username = process.env.SYSTEM_USERNAME ?? "admin";
    const repository = new SystemUserRepository();
    const existingUser = await repository.findByUsername(username);

    if (existingUser) {
        return;
    }

    const configuredPassword = process.env.SYSTEM_PASSWORD;
    const password = configuredPassword ?? randomBytes(18).toString("base64url");
    await repository.create(username, await hashPassword(password));

    if (!configuredPassword) {
        // This is shown only once. Save it somewhere secure; it cannot be recovered.
        console.log("Generated system Basic Auth credentials:");
        console.log(`  username: ${username}`);
        console.log(`  password: ${password}`);
    }
}
