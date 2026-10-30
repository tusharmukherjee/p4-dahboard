import type { NextFunction, Request, Response } from "express";

const LOCAL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function allowConfiguredOrigins(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const origin = req.header("origin");
    const configuredOrigins = (process.env.CORS_ORIGINS ?? "")
        .split(",")
        .map((value) => value.trim().replace(/\/$/, ""))
        .filter(Boolean);
    const allowedOrigins = new Set([...LOCAL_ORIGINS, ...configuredOrigins]);

    if (origin && allowedOrigins.has(origin.replace(/\/$/, ""))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
        res.setHeader("Access-Control-Max-Age", "86400");
    }

    if (req.method === "OPTIONS") {
        if (origin && allowedOrigins.has(origin.replace(/\/$/, ""))) {
            res.sendStatus(204);
        } else {
            res.status(403).json({ error: "Origin is not allowed" });
        }
        return;
    }

    next();
}
