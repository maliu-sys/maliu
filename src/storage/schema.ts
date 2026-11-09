export const schema = `
  CREATE TABLE IF NOT EXISTS app_data (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL,
    updatedAt INTEGER NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL, conversationId TEXT NOT NULL,
    position INTEGER NOT NULL, createdAt INTEGER NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversationId, position);
  CREATE TABLE IF NOT EXISTS memory_clock (id INTEGER PRIMARY KEY CHECK(id = 1), value INTEGER NOT NULL);
  INSERT OR IGNORE INTO memory_clock VALUES (1, 0);
  CREATE TABLE IF NOT EXISTS memories (
    key TEXT PRIMARY KEY NOT NULL, value TEXT,
    evidence TEXT NOT NULL, conversationId TEXT, messageId TEXT,
    updatedAt INTEGER NOT NULL, changeOrder INTEGER NOT NULL, origin TEXT NOT NULL
  );
`;
