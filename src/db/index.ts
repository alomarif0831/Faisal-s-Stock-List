import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;

declare global {
  var __stock_db: DB | undefined;
}

function makeDb(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Let the app boot (and `next build` run) without a database; the
    // first query explains what's missing.
    return new Proxy({} as DB, {
      get() {
        throw new Error("DATABASE_URL is not set. See .env.example.");
      },
    });
  }
  // `prepare: false` keeps us compatible with pooled (pgbouncer) URLs,
  // which is what Neon/Supabase hand out for serverless.
  const client = postgres(url, { prepare: false, max: 5 });
  return drizzle(client, { schema });
}

export const db = globalThis.__stock_db ?? makeDb();
globalThis.__stock_db = db;

export * from "./schema";
