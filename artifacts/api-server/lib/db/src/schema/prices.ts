import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricesTable = pgTable("prices", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  symbol: text("symbol").notNull(),
  price: numeric("price", { precision: 18, scale: 2 }).notNull(),
  change: numeric("change", { precision: 18, scale: 2 }),
  changePercent: numeric("change_percent", { precision: 10, scale: 4 }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPriceSchema = createInsertSchema(pricesTable).omit({ id: true });
export type InsertPrice = z.infer<typeof insertPriceSchema>;
export type Price = typeof pricesTable.$inferSelect;
