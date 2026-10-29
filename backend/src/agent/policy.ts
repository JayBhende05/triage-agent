/**
 * The risk policy. Pure: no database, no model, no network.
 * The model proposes; this decides whether the proposal may run and whether a human must look.
 */
import { toPaise } from "../lib/money.ts";
import type { Context, Flags, Proposal, Risk, Triage } from "./types.ts";

export const CONFIDENCE_THRESHOLD = 0.7;
export const MAX_TOOL_CALLS = 8;

const escalate = (reason: string): Risk => ({ final_action: "escalate", needs_approval: false, reasons: [reason] });

export function evaluate(
  ticket: { from_email: string },
  triage: Triage | null,
  proposal: Proposal | null,
  context: Context,
  flags: Flags,
): Risk {
  // The first escalation wins.
  if (flags.triage_invalid || flags.proposal_invalid) return escalate("invalid_output");
  if (flags.loop_guard) return escalate("loop_guard");
  if (!triage || !proposal) return escalate("invalid_output");
  if (triage.confidence < CONFIDENCE_THRESHOLD) return escalate("low_confidence");
  if (proposal.action === "escalate") return escalate("model_escalated");

  const orders = context.orders;
  if (proposal.order_id !== null && !(String(proposal.order_id) in orders)) return escalate("unverified_order");

  const sender = ticket.from_email.trim().toLowerCase();
  for (const o of Object.values(orders)) {
    if (o.owner_email.trim().toLowerCase() !== sender) return escalate("owner_mismatch");
  }

  if (proposal.action === "refund_and_reply") {
    const order = proposal.order_id === null ? undefined : orders[String(proposal.order_id)];
    const amount = toPaise(proposal.refund_amount_inr);
    const total = order ? toPaise(order.total_inr) : null;
    if (amount === null || amount <= 0 || total === null) return escalate("bad_refund");
    if (amount > total) return escalate("over_total");
    return { final_action: "refund_and_reply", needs_approval: true, reasons: ["refund"] };
  }

  if (proposal.action === "close_spam") {
    return { final_action: "close_spam", needs_approval: true, reasons: ["spam_close"] };
  }

  // reply
  if (triage.category === "complaint") return { final_action: "reply", needs_approval: true, reasons: ["complaint_reply"] };
  if (triage.category === "damaged_item") {
    return { final_action: "reply", needs_approval: true, reasons: ["damaged_item_reply"] };
  }
  return { final_action: "reply", needs_approval: false, reasons: [] };
}
