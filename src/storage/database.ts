import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { schema } from './schema';

let database: ReturnType<typeof open> | undefined;

async function open() {
  const db = await openDatabaseAsync('maliu.db');
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  await db.execAsync(schema);
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

// Serialize app writers; network requests never hold a transaction open.
let writes: Promise<unknown> = Promise.resolve();
export function writeTransaction<T>(
  work: (tx: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const result = writes.then(async () => {
    const db = await getDatabase();
    let value!: T;
    await db.withExclusiveTransactionAsync(async (tx) => {
      value = await work(tx);
    });
    return value;
  });
  writes = result.catch(() => undefined);
  return result;
}

export async function nextOrder(tx: SQLiteDatabase): Promise<number> {
  const row = await tx.getFirstAsync<{ value: number }>(
    'UPDATE memory_clock SET value = value + 1 WHERE id = 1 RETURNING value',
  );
  return row!.value;
}
