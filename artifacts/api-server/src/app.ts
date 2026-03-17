import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { startPriceScheduler } from "./lib/priceFetcher.js";

const app: Express = express();

app.get("/ping-test", (_req, res) => {
  res.send("ping ok");
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientDistCandidates = [
  path.resolve(process.cwd(), "../finance-tracker/dist/public"),
  path.resolve(process.cwd(), "artifacts/finance-tracker/dist/public"),
  path.resolve(process.cwd(), "finance-tracker/dist/public"),
  path.resolve(__dirname, "..", "..", "finance-tracker", "dist", "public"),
  path.resolve(__dirname, "..", "..", "..", "finance-tracker", "dist", "public"),
];

console.log("cwd =", process.cwd());
console.log("__dirname =", __dirname);
console.log("clientDistCandidates =", clientDistCandidates);

const clientDist = clientDistCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, "index.html")),
);

console.log("clientDist =", clientDist);

if (clientDist) {
  console.log("Serving frontend from:", clientDist);

  app.use(express.static(clientDist));

  app.get("/", (_req, res) => {
    console.log("GET / -> index.html");
    res.sendFile(path.join(clientDist, "index.html"));
  });

  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    console.log("SPA fallback for:", req.path);
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  console.log("No frontend build found");
}

startPriceScheduler();

export default app;