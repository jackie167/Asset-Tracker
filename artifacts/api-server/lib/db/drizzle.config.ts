import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/src/schema",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});