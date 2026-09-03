/// <reference types="@cloudflare/vitest-plugin" />
import { env } from "cloudflare:test";
import schema from "../migrations/0001_platform.sql?raw";

// Fresh platform schema for every test run. The migration file is the
// single source of truth — tests never duplicate its DDL. D1 exec()
// rejects comment-only chunks, so strip comments and run the statements
// as a batch.
const statements = schema
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
