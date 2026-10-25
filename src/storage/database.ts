import { openDatabaseAsync } from 'expo-sqlite';

let database: ReturnType<typeof open> | undefined;

async function open() {
  const db = await openDatabaseAsync('maliu.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export function getDatabase() {
  database ??= open().catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}

export async function readValue(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_data WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function writeValue(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT INTO app_data (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}
