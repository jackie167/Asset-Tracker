import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { startPriceScheduler } from "./lib/priceFetcher.js";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

startPriceScheduler();

export default app;
