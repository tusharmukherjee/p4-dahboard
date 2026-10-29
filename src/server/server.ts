import { app } from "../routes/app.js";
import { initializeSystemUser } from "../auth/initializeSystemUser.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const server = await startServer();

async function startServer() {
    // Run `npm run db:migrate` before the first startup so these tables exist.
    await initializeSystemUser();

    return app.listen(port, host, () => {
        console.log(`Server running at http://${host}:${port}`);
    });
}

function shutdown(signal: string): void {
    console.log(`${signal} recieved. Shutting down server.`);

    server.close((error) => {
        if (error) {
        console.error("Failed to close server:", error);
        process.exit(1);
        }

        process.exit(0);
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
