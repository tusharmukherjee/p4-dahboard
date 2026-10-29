import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
const HASH_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, HASH_LENGTH) as Buffer;

    // The salt is safe to store beside the hash; the plaintext password is not.
    return `${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedValue: string): Promise<boolean> {
    const [encodedSalt, encodedHash] = storedValue.split(":");
    if (!encodedSalt || !encodedHash) {
        return false;
    }

    const expectedHash = Buffer.from(encodedHash, "base64url");
    const actualHash = await scrypt(
        password,
        Buffer.from(encodedSalt, "base64url"),
        expectedHash.length,
    ) as Buffer;

    return expectedHash.length === actualHash.length
        && timingSafeEqual(expectedHash, actualHash);
}
