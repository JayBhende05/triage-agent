import { migrate, pool } from "./index.ts";

await migrate();
console.log("schema ready");
await pool.end();
