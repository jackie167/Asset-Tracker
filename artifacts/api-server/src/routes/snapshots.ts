import { Router, type IRouter } from "express";
import { db, snapshotsTable } from "@workspace/db";
import { desc, gte } from "drizzle-orm";
import { ListSnapshotsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/snapshots", async (_req, res): Promise<void> => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const snapshots = await db
    .select()
    .from(snapshotsTable)
    .where(gte(snapshotsTable.snapshotAt, sevenDaysAgo))
    .orderBy(desc(snapshotsTable.snapshotAt))
    .limit(200);

  res.json(
    ListSnapshotsResponse.parse(
      snapshots.map((s) => ({
        ...s,
        totalValue: parseFloat(String(s.totalValue)),
        stockValue: parseFloat(String(s.stockValue)),
        goldValue: parseFloat(String(s.goldValue)),
      }))
    )
  );
});

export default router;
