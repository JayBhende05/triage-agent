// Runs before every test file (bunfig.toml). Points the app at a separate test database,
// which is created on first use, so tests can never touch the dev data.
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL ?? "postgres://triage:triage@localhost:5434/triage_mvp_test";
const name = new URL(url).pathname.slice(1);
if (!name.endsWith("_test")) throw new Error(`refusing to run tests against "${name}": the database name must end in _test`);

process.env.DATABASE_URL = url;

const admin = new URL(url);
admin.pathname = "/postgres";
const client = new Client({ connectionString: admin.toString() });
await client.connect();
const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
if (!exists.rows[0]) await client.query(`CREATE DATABASE "${name}"`);
await client.end();

const { migrate } = await import("../src/db/index.ts");
const { openCheckpointer } = await import("../src/agent/checkpointer.ts");
await migrate();
await (await openCheckpointer()).end();
