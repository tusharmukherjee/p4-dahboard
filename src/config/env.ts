import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Resolve from this module instead of process.cwd(), so both `npm run dev`
// (src/config) and `npm start` (dist/config) load p4backend/.env.
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));

if (existsSync(envPath)) {
    loadEnvFile(envPath);
}
