import type { NextFunction, Request, Response } from "express";
import { verifyPassword } from "./password.js";
import { SystemUserRepository } from "./systemUserRepository.js";

const users = new SystemUserRepository();

export async function requireBasicAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const authorization = req.header("authorization");

    try {
        if (!authorization?.startsWith("Basic ")) {
            reject(res);
            return;
        }

        const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
        const separator = decoded.indexOf(":");
        if (separator < 1) {
            reject(res);
            return;
        }

        const username = decoded.slice(0, separator);
        const password = decoded.slice(separator + 1);
        const user = await users.findByUsername(username);

        if (!user || !await verifyPassword(password, user.passwordHash)) {
            reject(res);
            return;
        }

        res.locals.systemUser = { id: user.id, username: user.username };
        next();
    } catch (error) {
        next(error);
    }
}

function reject(res: Response): void {
    res.setHeader("WWW-Authenticate", 'Basic realm="P4 Dashboard", charset="UTF-8"');
    res.status(401).json({ error: "Authentication required" });
}
