
import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/agent/policy.ts";
import type {
  Context,
  Flags,
  Proposal,
  Triage,
} from "../src/agent/types.ts";

const ticket = {
  from_email: "rohan@example.com",
};

const triage: Triage = {
  category: "order_status",
  confidence: 0.95,
  summary: "Customer wants an order update.",
};

const proposal: Proposal = {
  action: "reply",
  order_id: 101,
  refund_amount_inr: null,
  reply_text: "Your order is being processed.",
};

const context: Context = {
  customers: {},
  orders: {
    "101": {
      id: 101,
      status: "processing",
      total_inr: "999.00",
      owner_email: "rohan@example.com",
    },
  },
};

const noFlags: Flags = {};

describe("Triage risk policy evaluation", () => {
  test("allows a verified normal reply", () => {
    const result = evaluate(
      ticket,
      triage,
      proposal,
      context,
      noFlags,
    );

    expect(result).toEqual({
      final_action: "reply",
      needs_approval: false,
      reasons: [],
    });
  });

  test("escalates low confidence", () => {
    const result = evaluate(
      ticket,
      { ...triage, confidence: 0.69 },
      proposal,
      context,
      noFlags,
    );

    expect(result.final_action).toBe("escalate");
    expect(result.reasons).toEqual(["low_confidence"]);
  });

  test("accepts confidence exactly at threshold", () => {
    const result = evaluate(
      ticket,
      { ...triage, confidence: 0.7 },
      proposal,
      context,
      noFlags,
    );

    expect(result.final_action).toBe("reply");
  });

  test("escalates invalid triage output", () => {
    const result = evaluate(
      ticket,
      triage,
      proposal,
      context,
      { triage_invalid: true },
    );

    expect(result.reasons).toEqual(["invalid_output"]);
  });

  test("escalates when tool loop guard is triggered", () => {
    const result = evaluate(
      ticket,
      triage,
      proposal,
      context,
      { loop_guard: true },
    );

    expect(result.reasons).toEqual(["loop_guard"]);
  });

  test("escalates an unverified order", () => {
    const result = evaluate(
      ticket,
      triage,
      { ...proposal, order_id: 999 },
      context,
      noFlags,
    );

    expect(result.reasons).toEqual(["unverified_order"]);
  });

  test("escalates an order owner mismatch", () => {
    const wrongOwner: Context = {
      ...context,
      orders: {
        "101": {
          ...context.orders["101"],
          owner_email: "another@example.com",
        },
      },
    };

    const result = evaluate(
      ticket,
      triage,
      proposal,
      wrongOwner,
      noFlags,
    );

    expect(result.reasons).toEqual(["owner_mismatch"]);
  });

  test("requires approval for refunds", () => {
    const refundProposal: Proposal = {
      action: "refund_and_reply",
      order_id: 101,
      refund_amount_inr: 499,
      reply_text: "Your refund has been proposed.",
    };

    const result = evaluate(
      ticket,
      triage,
      refundProposal,
      context,
      noFlags,
    );

    expect(result).toEqual({
      final_action: "refund_and_reply",
      needs_approval: true,
      reasons: ["refund"],
    });
  });

  test("escalates refunds greater than order total", () => {
    const refundProposal: Proposal = {
      action: "refund_and_reply",
      order_id: 101,
      refund_amount_inr: 1200,
      reply_text: "Your refund has been proposed.",
    };

    const result = evaluate(
      ticket,
      triage,
      refundProposal,
      context,
      noFlags,
    );

    expect(result.reasons).toEqual(["over_total"]);
  });

  test("requires approval for complaints", () => {
    const result = evaluate(
      ticket,
      { ...triage, category: "complaint" },
      proposal,
      context,
      noFlags,
    );

    expect(result.needs_approval).toBe(true);
  });
});
