/// <reference types="@cloudflare/vitest-plugin" />
import { env } from "cloudflare:test";
import schema from "../migrations/0001_platform.sql?raw";

// Fresh platform schema for every test run. The migration file is the
// single source of truth — tests never duplicate its DDL. D1 exec() rejects
// comment-only chunks, so strip comments and run statement-by-statement.
const statements = schema
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));

// Legacy single-invitation table for the frozen /api/rsvp routes, which
// stay live until WS6 retires them with the old frontend. Temporary.
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
