import { Router, type IRouter } from "express";
import healthRouter from "./health";
import holdingsRouter from "./holdings";
import pricesRouter from "./prices";
import snapshotsRouter from "./snapshots";
import importRouter from "./import";

const router: IRouter = Router();

router.use(healthRouter);
router.use(importRouter);
router.use(holdingsRouter);
router.use(pricesRouter);
router.use(snapshotsRouter);

export default router;
