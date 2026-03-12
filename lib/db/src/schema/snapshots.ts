import { pgTable, serial, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const snapshotsTable = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  totalValue: numeric("total_value", { precision: 22, scale: 2 }).notNull(),
  stockValue: numeric("stock_value", { precision: 22, scale: 2 }).notNull(),
  goldValue: numeric("gold_value", { precision: 22, scale: 2 }).notNull(),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSnapshotSchema = createInsertSchema(snapshotsTable).omit({ id: true });
export type InsertSnapshot = z.infer<typeof insertSnapshotSchema>;
export type Snapshot = typeof snapshotsTable.$inferSelect;
