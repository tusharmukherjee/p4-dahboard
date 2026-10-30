import "../config/env.js";
import express from "express";
import { DateTimeModule } from "../modules/dateAndTimeModule.js";
import { SpotifyModule } from "../modules/spotifyModule.js";
import { HackerNewsModule } from "../modules/hackerNewsModule.js";
import { GoogleCalendarModule } from "../modules/googleCalendarModule.js";
import { ModuleRegistry } from "../modules/moduleRegistry.js";
import { DashboardConfigurationRepository } from "../config/dashboardConfigRepository.js";
import { checkConfigVersion } from "../middleware/checkConfigVersion.js";
import { SpotifyOAuth } from "../oauth/spotifyOAuth.js";
import { requireBasicAuth } from "../auth/basicAuth.js";
import { GoogleOAuth } from "../oauth/googleOAuth.js";
import { ModuleDataService } from "../modules/moduleDataService.js";
import type { DashboardConfiguration } from "../config/dashboardConfig.js";
import { VocabularyModule } from "../modules/vocabularyModule.js";
import { CountdownModule } from "../modules/countdownModule.js";
import { allowConfiguredOrigins } from "../middleware/cors.js";

export const app = express();

app.use(allowConfiguredOrigins);
app.use(express.json());

const registry = new ModuleRegistry();
const googleOAuth = new GoogleOAuth();
registry.register(new DateTimeModule());
registry.register(new SpotifyModule());
registry.register(new HackerNewsModule());
registry.register(new GoogleCalendarModule(googleOAuth));
registry.register(new VocabularyModule());
registry.register(new CountdownModule());

const configRepository = new DashboardConfigurationRepository();
const spotifyOAuth = new SpotifyOAuth();
const moduleDataService = new ModuleDataService();

app.get("/spotify/login", requireBasicAuth, (_req, res) => {
    try {
        res.redirect(spotifyOAuth.createAuthorizationUrl());
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start Spotify authorization";
        res.status(500).json({ error: message });
    }
});

app.get("/callback", async (req, res) => {
    const spotifyError = typeof req.query.error === "string" ? req.query.error : null;
    if (spotifyError) {
        res.status(400).json({ error: `Spotify authorization was denied: ${spotifyError}` });
        return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) {
        res.status(400).json({ error: "Spotify callback requires code and state" });
        return;
    }

    try {
        const tokens = await spotifyOAuth.handleCallback(code, state);
        res.json({
            authorized: true,
            scope: tokens.scope,
            expiresIn: tokens.expiresIn,
            message: "Spotify is connected. Currently-playing requests are now available.",
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to complete Spotify authorization";
        res.status(400).json({ error: message });
    }
});

app.get("/google/login", requireBasicAuth, (_req, res) => {
    try {
        res.redirect(googleOAuth.createAuthorizationUrl());
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start Google authorization";
        res.status(500).json({ error: message });
    }
});

app.get("/google/callback", async (req, res) => {
    const googleError = typeof req.query.error === "string" ? req.query.error : null;
    if (googleError) {
        res.status(400).json({ error: `Google authorization was denied: ${googleError}` });
        return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) {
        res.status(400).json({ error: "Google callback requires code and state" });
        return;
    }

    try {
        const tokens = await googleOAuth.handleCallback(code, state);
        res.json({
            authorized: true,
            scope: tokens.scope,
            expiresIn: tokens.expiresIn,
            message: "Google Calendar is connected.",
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to complete Google authorization";
        res.status(400).json({ error: message });
    }
});

app.use("/api/modules", requireBasicAuth, checkConfigVersion(configRepository))

app.get('/health', (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString()
    })
})

app.get("/api/configuration/sync", requireBasicAuth, async (req, res) => {
    const rawVersion = req.query.version;
    const espVersion = typeof rawVersion === "string" && /^\d+$/.test(rawVersion)
        ? Number(rawVersion)
        : Number.NaN;

    if (!Number.isSafeInteger(espVersion) || espVersion < 0) {
        res.status(400).json({
            error: "version query parameter must be a non-negative integer",
        });
        return;
    }

    try {
        const configuration = await configRepository.getConfiguration();
        const changed = espVersion !== configuration.version;

        res.json(changed
            ? {
                changed: true,
                version: configuration.version,
                configuration,
            }
            : {
                changed: false,
                version: configuration.version,
            });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to check configuration";
        res.status(500).json({ error: message });
    }
});

app.get("/api/configuration", requireBasicAuth, async (_req, res) => {
    try {
        res.json(await configRepository.getConfiguration());
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to read configuration";
        res.status(500).json({ error: message });
    }
});

app.put("/api/configuration", requireBasicAuth, async (req, res) => {
    const expectedVersion = req.body?.expectedVersion;
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        res.status(400).json({ error: "expectedVersion must be a non-negative integer" });
        return;
    }

    try {
        const configuration = await configRepository.updateConfiguration(
            req.body?.modules,
            req.body?.brightness,
            expectedVersion,
        );
        if (!configuration) {
            const current = await configRepository.getConfiguration();
            res.status(409).json({
                error: "Configuration was updated by another request",
                currentVersion: current.version,
            });
            return;
        }

        moduleDataService.clear();
        res.json(configuration);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to update configuration";
        res.status(400).json({ error: message });
    }
});

app.post("/api/modules/:moduleId/data", async (req, res) => {
    const moduleId = req.params.moduleId;
    const module = registry.get(moduleId);

    if(!module){
        res.status(404).json({
            error: `Module ${moduleId} not found`
        })
        return;
    }

    try{
        const configuration = res.locals.dashboardConfiguration as DashboardConfiguration;
        const moduleConfig = configuration.modules.find((item) => item.moduleId === moduleId);
        const cacheKey = moduleDataService.createCacheKey(
            moduleId,
            configuration.version,
            req.body?.payload ?? req.body,
        );
        const { moduleResult, cache } = await moduleDataService.getData(
            module,
            req.body,
            {
                now: new Date(),
            },
            {
                refreshTime: moduleConfig?.refreshTime,
                cacheKey,
            },
        )
        res.json({
            ...moduleResult,
            cache,
            configSync: res.locals.configSync
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown module error";
        res.status(500).json({
            error: message
        })
    }

})
