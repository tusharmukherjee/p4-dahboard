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
import { FootballModule } from "../modules/footballModule.js";
import { DashboardModuleCatalogRepository } from "../config/dashboardModuleCatalogRepository.js";
import { competitions, teams, saveToken, tokenConfigured, FootballProviderError } from "../football/footballService.js";
import { OAuthTokenRepository } from "../auth/oauthTokenRepository.js";

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
registry.register(new FootballModule());

const configRepository = new DashboardConfigurationRepository();
const spotifyOAuth = new SpotifyOAuth();
const moduleDataService = new ModuleDataService();
const moduleCatalog = new DashboardModuleCatalogRepository();
const oauthTokens = new OAuthTokenRepository();

function finishOAuth(
    res: express.Response,
    provider: "spotify" | "google",
    status: "connected" | "error",
    message: string,
): void {
    const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");
    if (frontendUrl) {
        const targetOrigin = new URL(frontendUrl).origin;
        const payload = JSON.stringify({ type: "p4-oauth", provider, status, message })
            .replaceAll("<", "\\u003c");
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
        res.type("html").send(`<!doctype html><html><head><title>OAuth complete</title></head>
<body style="background:#090b10;color:#edeff3;font:16px sans-serif;text-align:center;padding:48px">
<p>${status === "connected" ? "Connection completed. This window will close." : "Connection failed. You can close this window."}</p>
<script>if(window.opener){window.opener.postMessage(${payload},${JSON.stringify(targetOrigin)});window.close()}</script>
<a style="color:#c9ff3d" href="${frontendUrl}">Return to dashboard</a></body></html>`);
        return;
    }
    res.status(status === "connected" ? 200 : 400).json({
        authorized: status === "connected",
        provider,
        message,
    });
}

function footballFailure(error: unknown, res: express.Response): void {
    res.status(error instanceof FootballProviderError ? error.status : 500).json({
        error: error instanceof Error ? error.message : "Football request failed",
    });
}

app.get("/api/football/token", requireBasicAuth, async (_req, res) => {
    try { res.json({ configured: await tokenConfigured() }); }
    catch (error) { footballFailure(error, res); }
});

app.put("/api/football/token", requireBasicAuth, async (req, res) => {
    try {
        if (typeof req.body?.token !== "string") {
            res.status(400).json({ error: "token must be a string" });
            return;
        }
        await saveToken(req.body.token);
        moduleDataService.clear();
        res.json({ configured: true });
    } catch (error) { footballFailure(error, res); }
});

app.get("/api/football/competitions", requireBasicAuth, async (_req, res) => {
    try { res.json({ competitions: await competitions() }); }
    catch (error) { footballFailure(error, res); }
});

app.get("/api/football/competitions/:code/teams", requireBasicAuth, async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(code)) {
        res.status(400).json({ error: "Invalid competition code" });
        return;
    }
    try { res.json({ teams: await teams(code) }); }
    catch (error) { footballFailure(error, res); }
});

app.get("/spotify/login", requireBasicAuth, (_req, res) => {
    try {
        res.redirect(spotifyOAuth.createAuthorizationUrl());
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start Spotify authorization";
        res.status(500).json({ error: message });
    }
});

app.get("/api/integrations", requireBasicAuth, async (_req, res) => {
    try {
        const [spotify, google] = await Promise.all([
            oauthTokens.status("spotify"),
            oauthTokens.status("google"),
        ]);
        res.json({ spotify, google });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to read integrations";
        res.status(500).json({ error: message });
    }
});

app.post("/api/integrations/:provider/authorize", requireBasicAuth, (req, res) => {
    try {
        const provider = req.params.provider;
        if (provider === "spotify") {
            res.json({ authorizationUrl: spotifyOAuth.createAuthorizationUrl() });
            return;
        }
        if (provider === "google") {
            res.json({ authorizationUrl: googleOAuth.createAuthorizationUrl() });
            return;
        }
        res.status(404).json({ error: "Unsupported OAuth provider" });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start authorization";
        res.status(500).json({ error: message });
    }
});

app.get("/callback", async (req, res) => {
    const spotifyError = typeof req.query.error === "string" ? req.query.error : null;
    if (spotifyError) {
        finishOAuth(res, "spotify", "error", `Spotify authorization was denied: ${spotifyError}`);
        return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) {
        finishOAuth(res, "spotify", "error", "Spotify callback requires code and state");
        return;
    }

    try {
        await spotifyOAuth.handleCallback(code, state);
        finishOAuth(res, "spotify", "connected", "Spotify is connected. Currently-playing requests are now available.");
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to complete Spotify authorization";
        finishOAuth(res, "spotify", "error", message);
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
        finishOAuth(res, "google", "error", `Google authorization was denied: ${googleError}`);
        return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) {
        finishOAuth(res, "google", "error", "Google callback requires code and state");
        return;
    }

    try {
        await googleOAuth.handleCallback(code, state);
        finishOAuth(res, "google", "connected", "Google Calendar is connected.");
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to complete Google authorization";
        finishOAuth(res, "google", "error", message);
    }
});

app.use("/api/modules", requireBasicAuth, checkConfigVersion(configRepository))

app.get('/health', (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString()
    })
})

app.get("/api/module-catalog", requireBasicAuth, async (_req, res) => {
    try {
        res.json({ modules: await moduleCatalog.list() });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to read module catalog";
        res.status(500).json({ error: message });
    }
});

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
    const configuration = res.locals.dashboardConfiguration as DashboardConfiguration;
    const moduleConfig = configuration.modules.find((item) => item.moduleId === moduleId);
    const module = registry.get(moduleConfig?.moduleType ?? moduleId);

    if(!moduleConfig || !module){
        res.status(404).json({
            error: `Module ${moduleId} not found`
        })
        return;
    }

    try{
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
            moduleId,
            cache,
            configSync: res.locals.configSync
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown module error";
        res.status(error instanceof FootballProviderError ? error.status : 500).json({
            error: message
        })
    }

})
