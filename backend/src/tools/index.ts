/**
 * The four tools and the one way to run them, callTool().
 *
 * The model is only ever shown the two lookup tools (modelFacingSpecs). The write tools run
 * from code after approval, and they take the ticket id from ToolContext, which the caller
 * sets, so no tool argument can point at another ticket.
 */
import { z } from "zod";
import { audit, pool } from "../db/index.ts";
import { fromPaise, toPaise } from "../lib/money.ts";

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { kind: string; message: string } };

export interface ToolContext {
  ticketId: number;
}

class ToolError extends Error {
  constructor(
    readonly kind: "not_found" | "business_rule",
    message: string,
  ) {
    super(message);
  }
}

export interface ToolSpec {
  name: string;
  description: string;
  input: z.ZodType;
  modelFacing: boolean;
  // Args have already passed `input`, so each tool can type its own.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (args: any, ctx: ToolContext) => Promise<unknown>;
}

const email = z.string().trim().toLowerCase().pipe(z.email());
const orderId = z.coerce.number().int().positive();
const amount = z
  .union([z.string(), z.number()])
  .refine((v) => (toPaise(v) ?? 0) > 0, "amount must be a positive number with at most 2 decimals");

export const TOOLS: ToolSpec[] = [
  {
    name: "lookup_customer",
    description: "Find a customer by email address. Returns the customer or a not_found error.",
    input: z.strictObject({ email: email.describe("The customer's email address") }),
    modelFacing: true,
    async run({ email }: { email: string }) {
      const { rows } = await pool.query("SELECT id, name, email FROM customers WHERE email = $1", [email]);
      if (!rows[0]) throw new ToolError("not_found", `no customer with email ${email}`);
      return rows[0];
    },
  },
  {
    name: "lookup_order",
    description: "Find an order by its number. Returns its status, total in INR and the owner's email.",
    input: z.strictObject({ order_id: orderId.describe("The order number, e.g. 1001") }),
    modelFacing: true,
    async run({ order_id }: { order_id: number }) {
      const { rows } = await pool.query(
        `SELECT o.id, o.status, o.total_inr, c.email AS owner_email
           FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
        [order_id],
      );
      if (!rows[0]) throw new ToolError("not_found", `no order ${order_id}`);
      return rows[0];
    },
  },
  {
    name: "create_refund",
    description: "Record a refund for an order. Idempotent. Not available to the model.",
    input: z.strictObject({ order_id: orderId, amount_inr: amount, reason: z.string().trim().min(1) }),
    modelFacing: false,
    async run(args: { order_id: number; amount_inr: string | number }, ctx) {
      return createRefund(ctx.ticketId, args.order_id, toPaise(args.amount_inr)!);
    },
  },
  {
    name: "draft_reply",
    description: "Save the reply text on the ticket. Not available to the model.",
    input: z.strictObject({ body: z.string().trim().min(1) }),
    modelFacing: false,
    async run({ body }: { body: string }, ctx) {
      const r = await pool.query("UPDATE tickets SET draft_reply = $2 WHERE id = $1", [ctx.ticketId, body]);
      if (r.rowCount === 0) throw new ToolError("not_found", `no ticket ${ctx.ticketId}`);
      return { ticket_id: ctx.ticketId, length: body.length };
    },
  },
];

export function modelFacingSpecs(): ToolSpec[] {
  return TOOLS.filter((t) => t.modelFacing);
}

/**
 * Same ticket + order + amount always gives the same key, so a repeat finds the first row.
 * The order row is locked first so two refunds on one order can't both pass the total check.
 */
async function createRefund(ticketId: number, order: number, amountPaise: number) {
  const key = `${ticketId}:${order}:${fromPaise(amountPaise)}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const o = await client.query("SELECT (total_inr * 100)::bigint AS total FROM orders WHERE id = $1 FOR UPDATE", [order]);
    if (!o.rows[0]) throw new ToolError("not_found", `no order ${order}`);

    const existing = await client.query("SELECT * FROM refunds WHERE idempotency_key = $1", [key]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { refund: existing.rows[0], created: false };
    }

    const sum = await client.query(
      "SELECT COALESCE(SUM(amount_inr * 100), 0)::bigint AS paid FROM refunds WHERE order_id = $1",
      [order],
    );
    const total = Number(o.rows[0].total);
    const paid = Number(sum.rows[0].paid);
    if (paid + amountPaise > total) {
      throw new ToolError(
        "business_rule",
        `refunds on order ${order} would be ${fromPaise(paid + amountPaise)}, above its total ${fromPaise(total)}`,
      );
    }

    const ins = await client.query(
      `INSERT INTO refunds (ticket_id, order_id, amount_inr, idempotency_key)
       VALUES ($1,$2,$3,$4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
      [ticketId, order, fromPaise(amountPaise), key],
    );
    let row = ins.rows[0];
    if (!row) row = (await client.query("SELECT * FROM refunds WHERE idempotency_key = $1", [key])).rows[0];
    await client.query("COMMIT");
    return { refund: row, created: !!ins.rows[0] };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Validate, run, audit. Never throws: failures come back as { ok: false, error }. */
export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const result = await run(name, args, ctx);
  try {
    await audit(ctx.ticketId, "tool", name, args, result);
  } catch (e) {
    console.error("audit write failed", e);
  }
  return result;
}

async function run(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const spec = TOOLS.find((t) => t.name === name);
  if (!spec) return { ok: false, error: { kind: "unknown_tool", message: `no tool named ${name}` } };
  const parsed = spec.input.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: { kind: "validation", message: z.prettifyError(parsed.error) } };
  }
  try {
    return { ok: true, data: await spec.run(parsed.data, ctx) };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, error: { kind: e.kind, message: e.message } };
    console.error(`tool ${name} crashed`, e);
    return { ok: false, error: { kind: "internal", message: "tool failed unexpectedly" } };
  }
}
