import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import holdingsRouter from "./holdings.js";
import pricesRouter from "./prices.js";
import snapshotsRouter from "./snapshots.js";
import importRouter from "./import.js";
import excelRouter from "./excel.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(importRouter);
router.use(excelRouter);
router.use(holdingsRouter);
router.use(pricesRouter);
router.use(snapshotsRouter);

export default router;
