import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const holdingsTable = pgTable("holdings", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  symbol: text("symbol").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertHoldingSchema = createInsertSchema(holdingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHolding = z.infer<typeof insertHoldingSchema>;
export type Holding = typeof holdingsTable.$inferSelect;
