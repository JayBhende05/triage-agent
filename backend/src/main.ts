import { buildApp } from "./api/server.ts";
import { buildGraph } from "./agent/graph.ts";
import { openCheckpointer } from "./agent/checkpointer.ts";
import { GroqModel } from "./agent/model.ts";
import { config } from "./config.ts";
import { migrate } from "./db/index.ts";
import { sweepInterrupted } from "./agent/service.ts";

await migrate();
const swept = await sweepInterrupted();
if (swept) console.log(`marked ${swept} interrupted ticket(s) failed`);

const graph = buildGraph(new GroqModel(config.groqApiKey), await openCheckpointer());
const app = buildApp(graph);
await app.listen({ port: config.port, host: "0.0.0.0" });
console.log(`listening on :${config.port}`);
