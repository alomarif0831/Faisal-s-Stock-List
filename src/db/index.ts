import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;

declare global {
  var __stock_db: DB | undefined;
}

// Vercel's Neon integration sets DATABASE_URL; the others are aliases it
// (or a custom prefix) may create.
function databaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL;
  if (!raw) return undefined;
  try {
    // Neon URLs carry `channel_binding=require`, which libpq understands but
    // postgres.js forwards to the server as a startup parameter, and the
    // server rejects it ("unrecognized configuration parameter").
    const url = new URL(raw);
    url.searchParams.delete("channel_binding");
    return url.toString();
  } catch {
    return raw;
  }
}

function makeDb(): DB {
  const url = databaseUrl();
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
