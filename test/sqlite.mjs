import { DatabaseSync } from 'node:sqlite';

// Each scenario runs in its own process with a private real SQLite database.
const database = new DatabaseSync(':memory:');
const adapter = {
  async execAsync(sql) {
    database.exec(sql);
  },
  async runAsync(sql, ...params) {
    return database.prepare(sql).run(...params);
  },
  async getFirstAsync(sql, ...params) {
    return database.prepare(sql).get(...params) ?? null;
  },
  async getAllAsync(sql, ...params) {
    return database.prepare(sql).all(...params);
  },
  async withExclusiveTransactionAsync(work) {
    database.exec('BEGIN');
    try {
      await work(adapter);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },
};

export async function openDatabaseAsync() {
  return adapter;
}
