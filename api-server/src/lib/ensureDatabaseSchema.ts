import { pool } from "../../../lib/db/src/index.ts";

export async function ensureDatabaseSchema() {
  await pool.query(`
    ALTER TABLE holdings
      ADD COLUMN IF NOT EXISTS cost_of_capital numeric(18, 2),
      ADD COLUMN IF NOT EXISTS interest numeric(18, 2)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      side text NOT NULL,
      funding_source text NOT NULL,
      asset_type text NOT NULL,
      symbol text NOT NULL,
      quantity numeric(18, 6) NOT NULL,
      total_value numeric(18, 2) NOT NULL,
      unit_price numeric(18, 2),
      realized_interest numeric(18, 2),
      note text,
      status text NOT NULL DEFAULT 'recorded',
      executed_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
