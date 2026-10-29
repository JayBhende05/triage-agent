import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { config } from "../config.ts";

// pg returns numeric(10,2) as a string, which is what we want: money never becomes a float.
export const pool = new Pool({ connectionString: config.databaseUrl });

export async function migrate(): Promise<void> {
  await pool.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

export async function audit(
  ticketId: number,
  kind: "llm" | "tool" | "decision",
  name: string,
  input: unknown,
  output: unknown,
): Promise<void> {
  await pool.query(
    "INSERT INTO audit_log (ticket_id, kind, name, input, output) VALUES ($1,$2,$3,$4,$5)",
    [ticketId, kind, name, JSON.stringify(input ?? null), JSON.stringify(output ?? null)],
  );
}
