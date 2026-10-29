import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { config } from "../config.ts";

/** The checkpoint tables live in the same database, so a paused ticket survives a restart. */
export async function openCheckpointer(): Promise<PostgresSaver> {
  const saver = PostgresSaver.fromConnString(config.databaseUrl);
  await saver.setup();
  return saver;
}
