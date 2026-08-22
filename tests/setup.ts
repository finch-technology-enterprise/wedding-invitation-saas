import { env } from "cloudflare:test";

await env.DB.prepare(
  `CREATE TABLE IF NOT EXISTS rsvps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    attending INTEGER NOT NULL,
    guests INTEGER NOT NULL DEFAULT 1,
    phone TEXT,
    instagram TEXT,
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`
).run();
