import { z } from "zod";

export const CATEGORIES = ["order_status", "refund", "complaint", "damaged_item", "spam", "other"] as const;
export const ACTIONS = ["reply", "refund_and_reply", "close_spam", "escalate"] as const;

export const TriageSchema = z.object({
  category: z.enum(CATEGORIES),
  confidence: z.number().min(0).max(1).describe("0 to 1"),
  summary: z.string().describe("One or two sentences on what the customer wants"),
});
export type Triage = z.infer<typeof TriageSchema>;

export const ProposalSchema = z.object({
  action: z.enum(ACTIONS),
  order_id: z.number().int().nullable().describe("The order this is about, or null"),
  refund_amount_inr: z
    .union([z.string(), z.number()])
    .nullable()
    .describe("Refund in rupees, like 499.00. Only for refund_and_reply, otherwise null"),
  reply_text: z.string().nullable().describe("The reply to the customer. Null for escalate or close_spam"),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const DecisionSchema = z.strictObject({
  verdict: z.enum(["approve", "reject"]),
  refund_amount_inr: z.union([z.string(), z.number()]).optional(),
  reply_text: z.string().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export interface OrderFact {
  id: number;
  status: string;
  total_inr: string;
  owner_email: string;
}

/** What the tools returned. The only source of truth for owners and totals. */
export interface Context {
  customers: Record<string, { id: number; name: string; email: string }>;
  orders: Record<string, OrderFact>;
}

export interface Flags {
  triage_invalid?: boolean;
  proposal_invalid?: boolean;
  loop_guard?: boolean;
}

export interface Risk {
  final_action: (typeof ACTIONS)[number];
  needs_approval: boolean;
  reasons: string[];
}
