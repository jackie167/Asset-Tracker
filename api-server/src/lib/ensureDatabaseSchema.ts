import { pool } from "../../../lib/db/src/index.ts";

export async function ensureDatabaseSchema() {
  await pool.query(`
    ALTER TABLE holdings
      ADD COLUMN IF NOT EXISTS cost_of_capital numeric(18, 2),
      ADD COLUMN IF NOT EXISTS interest numeric(18, 2)
  `);
}
