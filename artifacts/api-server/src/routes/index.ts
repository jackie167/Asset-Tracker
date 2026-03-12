import { Router, type IRouter } from "express";
import healthRouter from "./health";
import holdingsRouter from "./holdings";
import pricesRouter from "./prices";
import snapshotsRouter from "./snapshots";

const router: IRouter = Router();

router.use(healthRouter);
router.use(holdingsRouter);
router.use(pricesRouter);
router.use(snapshotsRouter);

export default router;
