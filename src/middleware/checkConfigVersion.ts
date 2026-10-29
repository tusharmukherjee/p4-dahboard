import type {
    NextFunction,
    Request,
    Response
} from "express";

import type { DashboardConfigurationRepository } from "../config/dashboardConfigRepository.js"

export function checkConfigVersion(
    repository: DashboardConfigurationRepository,
) {
    return async function (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        const espVersion = req.body?.version;
        if (!Number.isInteger(espVersion) || espVersion < 0) {
            res.status(400).json({
                error: "version must be a non-negative integer",
            });

            return;
        }

        try {
            const configuration = await repository.getConfiguration();
            // Keep the parsed configuration for the module route so the file
            // is read only once per request.
            res.locals.dashboardConfiguration = configuration;

            const changed = espVersion !== configuration.version;

            if (changed) {
                res.locals.configSync = {
                changed: true,
                version: configuration.version,
                configuration,
                };
            } else {
                res.locals.configSync = {
                changed: false,
                version: configuration.version,
                };
            }

            next();
        } catch (error) {
            const message =
                error instanceof Error
                ? error.message
                : "Unable to read configuration";

            res.status(500).json({
                error: message,
            });
        }

    }
}
