import { buildGraph } from "../../src/agent/graph.ts";
import { openCheckpointer } from "../../src/agent/checkpointer.ts";
import { pool } from "../../src/db/index.ts";
import { lookup, ScriptedModel, type Script } from "./scripted-model.ts";

export async function newGraph(script: Script = {}) {
  const saver = await openCheckpointer();
  const model = new ScriptedModel(script);
  return { graph: buildGraph(model, saver), model, saver };
}

const triage = (category: string, confidence = 0.95) => ({ category, confidence, summary: `a ${category} ticket` });

// Seeded tickets: 1 safe reply, 2 refund, 3 spam, 4 complaint, 5 someone else's order, 6 refund over total.
export const scripts = {
  safeReply: (): Script => ({
    triage: [triage("order_status")],
    tools: [
      { toolCalls: [lookup("lookup_order", { order_id: 1001 })] },
      {},
    ],
    propose: [{ action: "reply", order_id: 1001, refund_amount_inr: null, reply_text: "Your order is on its way." }],
  }),
  refund: (amount: string | number = "2499.00"): Script => ({
    triage: [triage("refund")],
    tools: [
      { toolCalls: [lookup("lookup_customer", { email: "rohan@example.com" }), lookup("lookup_order", { order_id: 1003 })] },
      {},
    ],
    propose: [{ action: "refund_and_reply", order_id: 1003, refund_amount_inr: amount, reply_text: "Sorry about that. Refund issued." }],
  }),
  spam: (): Script => ({ triage: [triage("spam", 0.99)] }),
  complaint: (): Script => ({
    triage: [triage("complaint")],
    tools: [{ toolCalls: [lookup("lookup_order", { order_id: 1005 })] }, {}],
    propose: [{ action: "reply", order_id: 1005, refund_amount_inr: null, reply_text: "We are sorry for the delays." }],
  }),
  otherPersonsOrder: (): Script => ({
    triage: [triage("order_status")],
    tools: [{ toolCalls: [lookup("lookup_order", { order_id: 1002 })] }, {}],
    propose: [{ action: "reply", order_id: 1002, refund_amount_inr: null, reply_text: "It was delivered." }],
  }),
};

export async function ticket(id: number) {
  return (await pool.query("SELECT * FROM tickets WHERE id = $1", [id])).rows[0];
}
export async function refunds(ticketId?: number) {
  const q = ticketId === undefined ? ["SELECT * FROM refunds ORDER BY id", []] : ["SELECT * FROM refunds WHERE ticket_id = $1 ORDER BY id", [ticketId]];
  return (await pool.query(q[0] as string, q[1] as number[])).rows;
}
export async function approvalFor(ticketId: number) {
  return (await pool.query("SELECT * FROM approvals WHERE ticket_id = $1", [ticketId])).rows[0];
}
export async function auditNames(ticketId: number, kind: string) {
  return (await pool.query("SELECT name FROM audit_log WHERE ticket_id = $1 AND kind = $2 ORDER BY id", [ticketId, kind])).rows.map(
    (r) => r.name as string,
  );
}
