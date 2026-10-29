import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
    const encodedKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!encodedKey) {
        throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
    }

    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32) {
        throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    }

    return key;
}

export function encryptSecret(value: string): string {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), initializationVector);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    // Store everything needed for decryption in one versioned string.
    return [
        "v1",
        initializationVector.toString("base64url"),
        authenticationTag.toString("base64url"),
        encrypted.toString("base64url"),
    ].join(":");
}

export function decryptSecret(value: string): string {
    const [version, iv, tag, encrypted] = value.split(":");
    if (version !== "v1" || !iv || !tag || !encrypted) {
        throw new Error("Stored OAuth token has an unsupported encryption format");
    }

    const decipher = createDecipheriv(
        ALGORITHM,
        getEncryptionKey(),
        Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64url")),
        decipher.final(),
    ]).toString("utf8");
}
