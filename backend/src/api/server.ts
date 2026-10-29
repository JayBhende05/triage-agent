import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { TriageGraph } from "../agent/graph.ts";
import { pool } from "../db/index.ts";
import { AppError } from "../lib/errors.ts";
import { claimTicket, decide, runClaimed } from "../agent/service.ts";

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError(422, "invalid_request", z.prettifyError(r.error));
  return r.data;
}

const Id = z.object({ id: z.coerce.number().int().positive() });
const NewTicket = z.strictObject({
  from_email: z.string().trim().toLowerCase().pipe(z.email()),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
});
const Queue = z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() });

export type App = FastifyInstance & { idle(): Promise<void> };

export function buildApp(graph: TriageGraph): App {
  console.log("GROQ_API_KEY" , process.env.GROQ_API_KEY)
  const app = Fastify();
  // Background runs, so a test (or a shutdown) can wait for them.
  const running = new Set<Promise<void>>();

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(422).send({ error: { code: "invalid_request", message: (err as Error).message } });
    }
    app.log.error(err);
    return reply.code(500).send({ error: { code: "internal", message: "something went wrong" } });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "not_found", message: "no such route" } }));

  app.get("/api/health", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });

  app.get("/api/tickets", async () => {
    const { rows } = await pool.query(
      `SELECT t.id, t.from_email, t.subject, t.status, t.category, t.final_action, a.id AS approval_id, a.reasons
         FROM tickets t LEFT JOIN approvals a ON a.ticket_id = t.id ORDER BY t.id DESC`,
    );
    return { tickets: rows };
  });

  app.post("/api/tickets", async (req, reply) => {
    const t = parse(NewTicket, req.body);
    const { rows } = await pool.query(
      "INSERT INTO tickets (from_email, subject, body) VALUES ($1,$2,$3) RETURNING *",
      [t.from_email, t.subject, t.body],
    );
    return reply.code(201).send(rows[0]);
  });

  app.post("/api/tickets/:id/run", async (req, reply) => {
    const { id } = parse(Id, req.params);
    await claimTicket(id); // 404 or 409 here, before anything is started
    const task = runClaimed(id, graph).finally(() => running.delete(task));
    running.add(task);
    return reply.code(202).send({ id, status: "running" });
  });

  app.get("/api/tickets/:id", async (req) => {
    const { id } = parse(Id, req.params);
    const { rows } = await pool.query("SELECT * FROM tickets WHERE id = $1", [id]);
    if (!rows[0]) throw new AppError(404, "ticket_not_found", `no ticket ${id}`);
    const [approval, refunds, auditRows, state] = await Promise.all([
      pool.query("SELECT * FROM approvals WHERE ticket_id = $1", [id]),
      pool.query("SELECT * FROM refunds WHERE ticket_id = $1 ORDER BY id", [id]),
      pool.query("SELECT * FROM audit_log WHERE ticket_id = $1 ORDER BY id", [id]),
      graph.getState({ configurable: { thread_id: String(id) } }),
    ]);
    return {
      ticket: rows[0],
      proposal: state.values?.proposal ?? approval.rows[0]?.proposal ?? null,
      approval: approval.rows[0] ?? null,
      refunds: refunds.rows,
      audit: auditRows.rows,
    };
  });

  app.get("/api/approvals", async (req) => {
    const { status } = parse(Queue, req.query);
    const { rows } = await pool.query(
      `SELECT a.*, t.subject, t.from_email FROM approvals a JOIN tickets t ON t.id = a.ticket_id
        WHERE ($1::text IS NULL OR a.status = $1) ORDER BY a.id`,
      [status ?? null],
    );
    return { approvals: rows };
  });

  app.post("/api/approvals/:id/decision", async (req) => {
    const { id } = parse(Id, req.params);
    return decide(id, req.body, graph);
  });

  app.addHook("onClose", async () => {
    await Promise.allSettled([...running]);
  });
  return Object.assign(app, { idle: () => Promise.allSettled([...running]).then(() => {}) });
}
