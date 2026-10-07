import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  readonly db: Db;
  readonly close: () => void;
}

const MIGRATIONS_FOLDER = join(import.meta.dirname, "migrations");

/** Opens (creating if needed) the SQLite database at `dbPath` and applies pending migrations. Use ":memory:" in tests. */
export const openDb = (dbPath: string): DbHandle => {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  try {
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (error) {
    sqlite.close();
    throw new Error(`Failed to migrate database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { db, close: () => sqlite.close() };
};
