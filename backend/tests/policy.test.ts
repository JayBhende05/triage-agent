import { describe, expect, test } from "bun:test";
import { evaluate } from "../src/agent/policy.ts";
import type { Context, Flags, Proposal, Triage } from "../src/agent/types.ts";

const ticket = { from_email: "rohan@example.com" };
const order = (id: number, owner = "rohan@example.com", total = "2499.00") => ({ id, status: "delivered", total_inr: total, owner_email: owner });
const ctx = (...orders: ReturnType<typeof order>[]): Context => ({
  customers: {},
  orders: Object.fromEntries(orders.map((o) => [String(o.id), o])),
});
const triage = (category: Triage["category"] = "refund", confidence = 0.9): Triage => ({ category, confidence, summary: "s" });
const refund = (amount: Proposal["refund_amount_inr"] = "2499.00", order_id: number | null = 1003): Proposal => ({
  action: "refund_and_reply",
  order_id,
  refund_amount_inr: amount,
  reply_text: "ok",
});
const reply = (order_id: number | null = 1003): Proposal => ({ action: "reply", order_id, refund_amount_inr: null, reply_text: "ok" });
const run = (t: Triage | null, p: Proposal | null, c: Context = ctx(order(1003)), f: Flags = {}) => evaluate(ticket, t, p, c, f);

const escalated = (r: ReturnType<typeof run>, reason: string) => {
  expect(r.final_action).toBe("escalate");
  expect(r.needs_approval).toBe(false);
  expect(r.reasons).toEqual([reason]);
};

describe("escalation rules", () => {
  test("1. invalid triage output", () => escalated(run(null, null, ctx(), { triage_invalid: true }), "invalid_output"));
  test("1. invalid proposal output", () => escalated(run(triage(), null, ctx(), { proposal_invalid: true }), "invalid_output"));
  test("2. tool loop hit its call limit", () => escalated(run(triage(), null, ctx(), { loop_guard: true }), "loop_guard"));
  test("3. confidence below 0.7", () => escalated(run(triage("refund", 0.69), refund()), "low_confidence"));
  test("3. confidence exactly 0.7 passes", () => {
    expect(run(triage("refund", 0.7), refund()).final_action).toBe("refund_and_reply");
  });
  test("4. the model itself proposed escalate", () => {
    escalated(run(triage(), { action: "escalate", order_id: null, refund_amount_inr: null, reply_text: null }), "model_escalated");
  });
  test("5. proposed order was never returned by a tool", () => escalated(run(triage(), refund("10", 9999)), "unverified_order"));
  test("6. a looked-up order belongs to someone else", () => {
    escalated(run(triage(), refund(), ctx(order(1003, "asha@example.com"))), "owner_mismatch");
  });
  test("6. any looked-up order counts, not only the proposed one", () => {
    escalated(run(triage(), refund(), ctx(order(1003), order(1002, "asha@example.com", "799.00"))), "owner_mismatch");
  });
  test("6. owner comparison ignores case", () => {
    expect(run(triage(), refund(), ctx(order(1003, "ROHAN@Example.com"))).final_action).toBe("refund_and_reply");
  });
  test("7. refund amount missing", () => escalated(run(triage(), refund(null)), "bad_refund"));
  test("7. refund order missing", () => escalated(run(triage(), refund("10", null)), "bad_refund"));
  test("7. refund amount zero", () => escalated(run(triage(), refund("0")), "bad_refund"));
  test("7. refund amount negative", () => escalated(run(triage(), refund("-5")), "bad_refund"));
  test("7. refund amount not a number", () => escalated(run(triage(), refund("lots")), "bad_refund"));
  test("7. refund above the order total", () => escalated(run(triage(), refund("2499.01")), "over_total"));
  test("7. refund equal to the total passes (compared in paise)", () => {
    const c = ctx(order(1003, "rohan@example.com", "1199.99"));
    expect(run(triage(), refund(1199.99), c).final_action).toBe("refund_and_reply");
    expect(run(triage(), refund("1199.990"), c).reasons).toEqual(["bad_refund"]);
  });
  test("the first escalation wins", () => {
    escalated(run(triage("refund", 0.1), refund(), ctx(order(1003, "asha@example.com"))), "low_confidence");
  });
});

describe("approval rules", () => {
  test("refund_and_reply needs approval", () => {
    expect(run(triage(), refund())).toEqual({ final_action: "refund_and_reply", needs_approval: true, reasons: ["refund"] });
  });
  test("close_spam needs approval", () => {
    const spam: Proposal = { action: "close_spam", order_id: null, refund_amount_inr: null, reply_text: null };
    expect(run(triage("spam", 0.99), spam, ctx())).toEqual({ final_action: "close_spam", needs_approval: true, reasons: ["spam_close"] });
  });
  test("a complaint reply needs approval", () => {
    expect(run(triage("complaint"), reply()).needs_approval).toBe(true);
  });
  test("a damaged_item reply needs approval", () => {
    expect(run(triage("damaged_item"), reply()).needs_approval).toBe(true);
  });
  test("any other reply is safe to run", () => {
    for (const c of ["order_status", "refund", "other"] as const) {
      expect(run(triage(c), reply())).toEqual({ final_action: "reply", needs_approval: false, reasons: [] });
    }
  });
});
