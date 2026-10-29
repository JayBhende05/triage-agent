/**
 * The decision rules that make the pause safe. The API calls these; so do the tests.
 *
 *  - claimTicket: one conditional UPDATE, so a double click cannot start a ticket twice.
 *  - decide: lock the approval row, check it is pending, validate the edits, record, resume.
 *  - any error during a run marks the ticket failed (with an audit row) so it can run again.
 */
import { Command } from "@langchain/langgraph";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { TriageGraph } from "./graph.ts";
import { audit, pool } from "../db/index.ts";
import { AppError } from "../lib/errors.ts";
import { toPaise } from "../lib/money.ts";
import { DecisionSchema, type Decision, type Proposal } from "./types.ts";

const thread = (ticketId: number) => ({ configurable: { thread_id: String(ticketId) } });

/** new|failed -> running. Throws 404 for an unknown ticket and 409 if it is already running or finished. */
export async function claimTicket(id: number): Promise<void> {
  const r = await pool.query("UPDATE tickets SET status = 'running' WHERE id = $1 AND status IN ('new','failed')", [id]);
  if (r.rowCount === 1) return;
  const { rows } = await pool.query("SELECT status FROM tickets WHERE id = $1", [id]);
  if (!rows[0]) throw new AppError(404, "ticket_not_found", `no ticket ${id}`);
  throw new AppError(409, "not_runnable", `ticket ${id} is ${rows[0].status}, so it cannot be run`);
}

/** Runs a claimed ticket from the start. Never throws: an error ends the ticket as failed. */
export async function runClaimed(id: number, graph: TriageGraph): Promise<void> {
  try {
    // A rerun starts clean. Refunds are not touched; their idempotency key protects them.
    await pool.query("DELETE FROM approvals WHERE ticket_id = $1", [id]);
    await pool.query("UPDATE tickets SET category = NULL, final_action = NULL, draft_reply = NULL WHERE id = $1", [id]);
    await (graph.checkpointer as PostgresSaver).deleteThread(String(id));
    await graph.invoke({ ticketId: id }, thread(id));
  } catch (e) {
    await markFailed(id, e);
  }
}

/** Claim, then run. For tests and scripts; the API claims first and runs in the background. */
export async function runTicket(id: number, graph: TriageGraph): Promise<void> {
  await claimTicket(id);
  await runClaimed(id, graph);
}

export async function markFailed(id: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await pool.query("UPDATE tickets SET status = 'failed' WHERE id = $1", [id]);
    await audit(id, "decision", "error", null, { message });
  } catch (e) {
    console.error(`could not mark ticket ${id} failed`, e);
  }
}

/** On startup: a ticket still "running" lost its process. Paused tickets (awaiting_approval) are left alone. */
export async function sweepInterrupted(): Promise<number> {
  const { rows } = await pool.query("UPDATE tickets SET status = 'failed' WHERE status = 'running' RETURNING id");
  for (const r of rows) await audit(r.id, "decision", "error", null, { message: "interrupted by restart" });
  return rows.length;
}

/** The edits get the same limits as the model's own proposal. */
async function validateEdits(
  client: { query: (q: string, v: unknown[]) => Promise<{ rows: any[] }> },
  proposal: Proposal,
  d: Decision,
): Promise<void> {
  const invalid = (m: string) => new AppError(422, "invalid_edit", m);
  const hasEdit = d.refund_amount_inr !== undefined || d.reply_text !== undefined;
  if (d.verdict === "reject" && hasEdit) throw invalid("a rejection cannot carry edits");

  if (d.reply_text !== undefined) {
    if (proposal.action !== "reply" && proposal.action !== "refund_and_reply") throw invalid("this proposal has no reply to edit");
    if (!d.reply_text.trim()) throw invalid("reply_text cannot be empty");
  }
  if (d.refund_amount_inr !== undefined) {
    if (proposal.action !== "refund_and_reply") throw invalid("this proposal has no refund to edit");
    const amount = toPaise(d.refund_amount_inr);
    if (amount === null || amount <= 0) throw invalid("refund_amount_inr must be a positive amount with at most 2 decimals");
    const { rows } = await client.query("SELECT (total_inr * 100)::bigint AS total FROM orders WHERE id = $1", [proposal.order_id]);
    if (!rows[0]) throw invalid(`order ${proposal.order_id} does not exist`);
    if (amount > Number(rows[0].total)) throw invalid("refund_amount_inr is above the order total");
  }
}

/**
 * Records one decision on one approval, then resumes the paused graph. A second decision on the
 * same approval gets 409. Returns the ticket's status afterwards.
 */
export async function decide(approvalId: number, input: unknown, graph: TriageGraph): Promise<{ ticket_id: number; status: string }> {
  const parsed = DecisionSchema.safeParse(input);
  if (!parsed.success) throw new AppError(422, "invalid_request", parsed.error.issues.map((i) => i.message).join("; "));
  const decision = parsed.data;

  const client = await pool.connect();
  let ticketId: number;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT a.ticket_id, a.status, a.proposal, t.status AS ticket_status
         FROM approvals a JOIN tickets t ON t.id = a.ticket_id
        WHERE a.id = $1 FOR UPDATE OF a`,
      [approvalId],
    );
    const a = rows[0];
    if (!a) throw new AppError(404, "approval_not_found", `no approval ${approvalId}`);
    if (a.status !== "pending" || a.ticket_status !== "awaiting_approval") {
      throw new AppError(409, "already_decided", `approval ${approvalId} is ${a.status}`);
    }
    await validateEdits(client, a.proposal, decision);

    await client.query("UPDATE approvals SET status = $2, decision = $3 WHERE id = $1", [
      approvalId,
      decision.verdict === "approve" ? "approved" : "rejected",
      JSON.stringify(decision),
    ]);
    await client.query("UPDATE tickets SET status = 'running' WHERE id = $1", [a.ticket_id]);
    await client.query("COMMIT");
    ticketId = a.ticket_id;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  await audit(ticketId, "decision", "human_decision", { approval_id: approvalId }, decision).catch(() => {});
  try {
    await graph.invoke(new Command({ resume: decision }), thread(ticketId));
  } catch (e) {
    await markFailed(ticketId, e);
  }
  const { rows } = await pool.query("SELECT status FROM tickets WHERE id = $1", [ticketId]);
  return { ticket_id: ticketId, status: rows[0].status };
}
