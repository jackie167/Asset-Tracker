import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.resolve(__dirname, "../../../.env"),
  path.resolve(__dirname, "../../.env"),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}
